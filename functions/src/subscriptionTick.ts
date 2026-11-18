/**
 * The daily subscription tick (PLAN-SUBSCRIBERS §10). For each subscription:
 *   1. bring the stored status up to what its dates say, audited as "subscription-tick" (S4);
 *   2. recount its tenancies, so an end date that has passed is uncounted (S4);
 *   3. send the lifecycle emails it is due, each claimed once (S5).
 * Then, 5. email Sasimem the operator digest, if there is anything to say (S5).
 * The purge (step 4) arrives with S6.
 *
 * Safe to run twice: each change is a compare-and-set or a create(), so the second run
 * writes and sends nothing. One org's failure does not stop the rest; the tick then
 * throws, so Cloud Scheduler retries.
 */
import { type CalendarDate, addDays, dateLabel, formatKina, pastDueSince, SUBSCRIPTION_TIMEZONE, subscriptionStatus, type Toea } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./admin.js";
import { createdOnOf, type LifecycleDeps, sendLifecycleNotices } from "./lifecycle.js";
import { type DigestLine, digestIsEmpty, type OperatorDigest, operatorDigest } from "./mail/templates.js";
import { MAIL_SECRETS } from "./params.js";
import { runsIn } from "./store/runs.js";
import { recountTenancies, settleStatus, subscriptionIds, subscriptionOf, subscriptionToday } from "./store/subscriptions.js";

export interface SubscriptionTickDeps extends LifecycleDeps {
  readonly now: () => Date;
  /** Where the digest goes when `sasimem/billing` names no contactEmail: the sending address. */
  readonly fallbackContact: () => string;
}

export interface SubscriptionTally {
  checked: number;
  /** Stored statuses brought up to date. */
  changed: number;
  /** Tenancy counts that had drifted. */
  recounted: number;
  /** Lifecycle emails sent. */
  emailed: number;
  /** 1 when the operator digest went today. */
  digest: number;
}

const DAY_MS = 86_400_000;
const daysFrom = (a: CalendarDate, b: CalendarDate): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const emptyDigest = (): { -readonly [K in keyof OperatorDigest]: DigestLine[] } =>
  ({ signups: [], trialsEnding: [], pastDue: [], restricted: [], held: [], bounces: [] });

export async function runSubscriptionTick(deps: SubscriptionTickDeps, opts: { readonly orgIds?: readonly string[] } = {}): Promise<SubscriptionTally> {
  const now = deps.now();
  const today = subscriptionToday(now);
  const tally: SubscriptionTally = { checked: 0, changed: 0, recounted: 0, emailed: 0, digest: 0 };
  const digest = emptyDigest();
  const names = new Map<string, string>();
  const errors: unknown[] = [];
  const failed = (orgId: string, e: unknown) => {
    errors.push(e);
    logger.error("subscription tick: one subscription failed", { orgId, error: e instanceof Error ? e.message : String(e) });
  };

  for (const orgId of await subscriptionIds(opts.orgIds)) {
    tally.checked++;
    try {
      const change = await settleStatus(orgId, now);
      if (change !== null) {
        tally.changed++;
        logger.info("subscription tick: status changed", { orgId, ...change });
      }
      if ((await recountTenancies(orgId, now))?.changed === true) tally.recounted++;
    } catch (e) {
      failed(orgId, e);
      continue;
    }
    try {
      tally.emailed += await sendLifecycleNotices(deps, orgId, now);
    } catch (e) {
      failed(orgId, e);
    }
    try {
      await noteForDigest(digest, names, orgId, now, today);
    } catch (e) {
      failed(orgId, e);
    }
  }

  // Held runs are across orgs, from the runs index.
  for (const run of await runsIn("held", opts.orgIds)) {
    digest.held.push({ orgId: run.orgId, name: names.get(run.orgId) ?? run.orgId, detail: `${run.period}, waiting for approval` });
  }
  try {
    if (await sendDigest(deps, digest, now, today)) tally.digest = 1;
  } catch (e) {
    failed("", e);
  }

  if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, `subscription tick: ${errors.length} failures; first: ${String(errors[0])}`);
  return tally;
}

/** Add what Sasimem should hear about this org to the digest. */
async function noteForDigest(digest: ReturnType<typeof emptyDigest>, names: Map<string, string>, orgId: string, now: Date, today: CalendarDate): Promise<void> {
  const [sub, org, failedEmails] = await Promise.all([
    subscriptionOf(orgId), db().doc(`orgs/${orgId}`).get(),
    db().collection(`orgs/${orgId}/emails`).where("sentAt", ">=", Timestamp.fromMillis(now.getTime() - DAY_MS)).get(),
  ]);
  if (sub === null || !org.exists) return;
  const name = String(org.get("name") ?? orgId);
  names.set(orgId, name);
  const line = (detail: string): DigestLine => ({ orgId, name, detail });

  const createdOn = createdOnOf(org.get("createdAt"));
  if (createdOn !== null && daysFrom(createdOn, today) <= 1 && daysFrom(createdOn, today) >= 0) {
    digest.signups.push(line(`${String(org.get("email") ?? "")}, ${sub.planId}${sub.trialEndsOn === null ? "" : `, trial to ${dateLabel(sub.trialEndsOn)}`}`));
  }
  const status = subscriptionStatus(sub, today);
  const owed = `${formatKina(sub.priceToea as Toea)} ${sub.interval}, ${sub.paymentReference ?? "no reference"}`;
  if (status === "trial" && sub.trialEndsOn !== null && daysFrom(today, sub.trialEndsOn) <= 7) {
    digest.trialsEnding.push(line(`ends ${dateLabel(sub.trialEndsOn)}, ${owed}`));
  }
  const since = pastDueSince(sub, today);
  if (status === "past_due") {
    digest.pastDue.push(line(since === null ? `never paid, ${owed}` : `unpaid since ${dateLabel(since)}, restricted from ${dateLabel(addDays(since, sub.graceDays))}, ${owed}`));
  }
  if (status === "restricted") {
    digest.restricted.push(line(sub.manuallyRestricted === true ? "restricted by hand" : `unpaid since ${since === null ? "the start" : dateLabel(since)}, ${owed}`));
  }
  for (const e of failedEmails.docs.filter((d) => d.get("status") === "failed")) {
    digest.bounces.push(line(`${String(e.get("kind"))} to ${String(e.get("to"))}: ${String(e.get("error") ?? "")}`));
  }
}

/** Email the digest once a day (claimed with create()), and only when it has something to say. */
async function sendDigest(deps: SubscriptionTickDeps, digest: OperatorDigest, now: Date, today: CalendarDate): Promise<boolean> {
  if (digestIsEmpty(digest)) return false;
  const claim = db().doc(`operatorDigests/${today}`);
  try {
    await claim.create({ at: now });
  } catch (e) {
    if ((e as { code?: unknown }).code === 6) return false; // already sent today
    throw e;
  }
  const contact = (await db().doc("sasimem/billing").get()).get("contactEmail") as string | undefined;
  try {
    await deps.mailer.send(operatorDigest({ to: typeof contact === "string" && contact !== "" ? contact : deps.fallbackContact(), date: today, digest }));
  } catch (e) {
    await claim.delete(); // so a retry sends it
    throw e;
  }
  return true;
}

type Log = (message: string, data: object) => void;

/** Run it, then log one "subscription tick done" line (the alert counts these) and record it for the console. */
export async function subscriptionTickAndLog(deps: SubscriptionTickDeps, opts: { readonly orgIds?: readonly string[] } = {}, log: Log = (m, d) => logger.info(m, d)): Promise<SubscriptionTally> {
  const tally = await runSubscriptionTick(deps, opts);
  log("subscription tick done", { event: "subscription_tick_done", ...tally });
  if (opts.orgIds === undefined) await db().doc("system/subscriptionTick").set({ lastSuccessAt: deps.now(), tally: { ...tally } });
  return tally;
}

/** Daily at 06:00 in Port Moresby, before the landlords' day. */
export function makeSubscriptionTick(deps: SubscriptionTickDeps) {
  return onSchedule({ schedule: "0 6 * * *", timeZone: SUBSCRIPTION_TIMEZONE, retryCount: 3, timeoutSeconds: 540, secrets: MAIL_SECRETS }, async () => {
    await subscriptionTickAndLog(deps);
  });
}
