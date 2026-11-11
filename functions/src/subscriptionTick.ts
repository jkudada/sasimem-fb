/**
 * The daily subscription tick (PLAN-SUBSCRIBERS §10), steps 1-2 (S4): bring each stored
 * status up to what its dates say, audited as "subscription-tick", and recount each org's
 * tenancies, so an end date that has passed is uncounted and a lost trigger is corrected.
 * Lifecycle emails (S5) and the purge (S6) join it later.
 *
 * Safe to run twice: each change is a compare-and-set, so the second run writes nothing.
 * One org's failure does not stop the rest; the tick then throws, so Cloud Scheduler retries.
 */
import { SUBSCRIPTION_TIMEZONE } from "@sasimem/core";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./admin.js";
import { recountTenancies, settleStatus, subscriptionIds } from "./store/subscriptions.js";

export interface SubscriptionTally {
  checked: number;
  /** Stored statuses brought up to date. */
  changed: number;
  /** Tenancy counts that had drifted. */
  recounted: number;
}

export async function runSubscriptionTick(deps: { readonly now: () => Date }, opts: { readonly orgIds?: readonly string[] } = {}): Promise<SubscriptionTally> {
  const now = deps.now();
  const tally: SubscriptionTally = { checked: 0, changed: 0, recounted: 0 };
  const errors: unknown[] = [];
  for (const orgId of await subscriptionIds(opts.orgIds)) {
    try {
      tally.checked++;
      const change = await settleStatus(orgId, now);
      if (change !== null) {
        tally.changed++;
        logger.info("subscription tick: status changed", { orgId, ...change });
      }
      if ((await recountTenancies(orgId, now))?.changed === true) tally.recounted++;
    } catch (e) {
      errors.push(e);
      logger.error("subscription tick: one subscription failed", { orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, `subscription tick: ${errors.length} failures; first: ${String(errors[0])}`);
  return tally;
}

type Log = (message: string, data: object) => void;

/** Run it, then log one "subscription tick done" line (the alert counts these) and record it for the console. */
export async function subscriptionTickAndLog(deps: { readonly now: () => Date }, opts: { readonly orgIds?: readonly string[] } = {}, log: Log = (m, d) => logger.info(m, d)): Promise<SubscriptionTally> {
  const tally = await runSubscriptionTick(deps, opts);
  log("subscription tick done", { event: "subscription_tick_done", ...tally });
  if (opts.orgIds === undefined) await db().doc("system/subscriptionTick").set({ lastSuccessAt: deps.now(), tally: { ...tally } });
  return tally;
}

/** Daily at 06:00 in Port Moresby, before the landlords' day and the 07:00 digest (S5). */
export function makeSubscriptionTick(deps: { readonly now: () => Date }) {
  return onSchedule({ schedule: "0 6 * * *", timeZone: SUBSCRIPTION_TIMEZONE, retryCount: 3, timeoutSeconds: 540 }, async () => {
    await subscriptionTickAndLog(deps);
  });
}
