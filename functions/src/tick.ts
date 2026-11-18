/**
 * The hourly tick (plan §6.4). Five steps in order - draft, request approval,
 * release, hold, remind - each safe to run twice or concurrently: every state change
 * is a create() or a compare-and-set, and only the tick that wins it sends email.
 *
 * One landlord's failure does not stop another's: each unit of work runs on its own,
 * errors are collected, and the tick then throws, so the execution fails visibly and
 * Cloud Scheduler retries.
 */
import { type BillingOrg, type InvoiceDocument, approvalRequestDue, periodsToDraft } from "@sasimem/core";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { type NotifyDeps, sendDigest, sendDispatch, sendHeld, sendReminder, sendTenantInvoice } from "./notify.js";
import type { DispatchLine } from "./mail/templates.js";
import { renderMissingPdfs } from "./store/pdfs.js";
import { claimReminder, unremindedInvoices } from "./store/reminders.js";
import { releaseRun } from "./store/release.js";
import { type OrgDoc, billingOf, draftRun, orgIdsToTick, runPeriodsOf, runsIn } from "./store/runs.js";
import { MAIL_SECRETS } from "./params.js";
import { db } from "./admin.js";
import { holdRun, mintTrackingToken, requestApproval } from "./store/tokens.js";
import { draftBlock } from "./store/subscriptions.js";

export type TickDeps = NotifyDeps;

export interface Tally {
  drafted: number;
  requested: number;
  /** Runs released to tenants. */
  sent: number;
  held: number;
  reminded: number;
  /** Orgs whose subscription stops new months (restricted, cancelled): step 1 passed them by. */
  skipped: number;
}

export interface TickOptions {
  /** Only these orgs (tests, plan §9.3). Every org when absent. */
  readonly orgIds?: readonly string[];
}

export async function runTick(deps: TickDeps, opts: TickOptions = {}): Promise<Tally> {
  const now = deps.now();
  const tally: Tally = { drafted: 0, requested: 0, sent: 0, held: 0, reminded: 0, skipped: 0 };
  const errors: unknown[] = [];
  const orgs = new Map<string, Promise<OrgDoc & BillingOrg>>();
  const orgOf = (orgId: string) => {
    let org = orgs.get(orgId);
    if (org === undefined) orgs.set(orgId, (org = billingOf(orgId).then((b) => b.org)));
    return org;
  };
  const each = async <T>(items: readonly T[], work: (item: T) => Promise<void>) => {
    for (const item of items) {
      try {
        await work(item);
      } catch (e) {
        errors.push(e);
        logger.error("tick: one unit of work failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  // 1. Draft the periods that are due, for every org whose subscription allows it
  //    (PLAN-SUBSCRIBERS D5). Only this step looks at the subscription: a run already
  //    drafted is approved, sent and reminded on below whatever the subscription says.
  await each(await orgIdsToTick(opts.orgIds), async (orgId) => {
    const [{ org, tenancies }, runPeriods, block] = await Promise.all([billingOf(orgId), runPeriodsOf(orgId), draftBlock(orgId, now)]);
    if (block !== null) {
      tally.skipped++;
      logger.info("tick: not drafting, subscription stops new months", { orgId, status: block.status });
      return;
    }
    for (const period of periodsToDraft({ org, tenancies, runPeriods, now })) {
      if ((await draftRun(orgId, period, now)) === "drafted") tally.drafted++;
    }
  });

  // 2. Request approval for draft runs whose lead time has begun.
  await each(await runsIn("draft", opts.orgIds), async (run) => {
    const org = await orgOf(run.orgId);
    if (!approvalRequestDue(run, org, now)) return;
    const token = deps.newToken();
    const outcome = await requestApproval(run.orgId, run.period, now, token);
    if (!outcome.requested) return;
    tally.requested++;
    await sendDigest(deps, run.orgId, org, run.period, token, outcome.target === "held");
  });

  // 3. Release approved runs at their send time.
  await each(await runsIn("approved", opts.orgIds), async (run) => {
    if (now < run.sendAt) return;
    await renderMissingPdfs(run.orgId, run.period);
    const outcome = await releaseRun(run.orgId, run.period, now);
    if (!outcome.released) {
      if (outcome.reason === "missingPdf") throw new Error(`orgs/${run.orgId}/runs/${run.period}: an invoice has no PDF, so nothing was sent`);
      return;
    }
    tally.sent++;
    if (outcome.invoices.length === 0) return; // everyone left out: nothing to send, nothing to track
    const failures = await sendToTenants(deps, run.orgId, outcome.invoices);
    const tracking = deps.newToken();
    await mintTrackingToken(run.orgId, run.period, now, tracking);
    await sendDispatch(deps, run.orgId, await orgOf(run.orgId), run.period, dispatchLines(outcome.invoices, failures), tracking);
    if (failures.size > 0) throw [...failures.values()][0];
  });

  // 4. Hold runs still waiting at their send time.
  await each(await runsIn("awaitingApproval", opts.orgIds), async (run) => {
    if (now < run.sendAt) return;
    const token = deps.newToken();
    if (!(await holdRun(run.orgId, run.period, now, token))) return;
    tally.held++;
    await sendHeld(deps, run.orgId, await orgOf(run.orgId), run.period, token);
  });

  // 5. Remind, last: nothing about it is urgent.
  await each(await unremindedInvoices(opts.orgIds), async ({ orgId, ref }) => {
    const invoice = await claimReminder(ref, await orgOf(orgId), now);
    if (invoice === null) return;
    tally.reminded++;
    await sendReminder(deps, orgId, ref.id, invoice);
  });

  logger.info("tick", { ...tally, errors: errors.length });
  if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, `tick: ${errors.length} failures; first: ${String(errors[0])}`);
  return tally;
}

type Sent = InvoiceDocument & { readonly id: string };

/** Email every tenant; one refused address does not stop the rest. Returns the failures by invoice ID. */
async function sendToTenants(deps: TickDeps, orgId: string, invoices: readonly Sent[]): Promise<Map<string, unknown>> {
  const failures = new Map<string, unknown>();
  for (const invoice of invoices) {
    try {
      await sendTenantInvoice(deps, orgId, invoice.id, invoice);
    } catch (e) {
      failures.set(invoice.id, e);
    }
  }
  return failures;
}

function dispatchLines(invoices: readonly Sent[], failures: ReadonlyMap<string, unknown>): DispatchLine[] {
  return [...invoices]
    .sort((a, b) => (a.numberSeq ?? 0) - (b.numberSeq ?? 0))
    .map((i) => ({ tenantName: i.snapshot?.tenantName ?? i.tenantName, number: i.number ?? "", totalToea: i.totalToea, sent: !failures.has(i.id) }));
}

/** The scheduled function: hourly, retried on failure (every step is safe to rerun). */
type Log = (message: string, data: object) => void;

/**
 * Run the tick, then log one structured "tick done" line. A log-based metric counts these
 * lines, and an alert fires when none arrives for 3 hours (plan §12; ops/alerts.ts). A tick
 * that throws logs nothing here: its error is the other alert.
 */
export async function tickAndLog(deps: TickDeps, opts: TickOptions = {}, log: Log = (m, d) => logger.info(m, d)): Promise<Tally> {
  const tally = await runTick(deps, opts);
  log("tick done", { event: "tick_done", ...tally });
  // Only a tick over every org says the tick is healthy; a scoped one (tests) is not the tick.
  if (opts.orgIds === undefined) await recordTickDone(deps.now(), tally);
  return tally;
}

/**
 * The console's Health page reads when the tick last succeeded (PLAN-SUBSCRIBERS §7).
 * The 3-hour alert still comes from the log line; this is for people, not paging.
 */
export async function recordTickDone(at: Date, tally: Tally): Promise<void> {
  await db().doc("system/tick").set({ lastSuccessAt: at, tally: { ...tally } });
}

export function makeTick(deps: TickDeps) {
  return onSchedule({ schedule: "every 60 minutes", retryCount: 3, timeoutSeconds: 540, secrets: MAIL_SECRETS }, async () => {
    await tickAndLog(deps);
  });
}
