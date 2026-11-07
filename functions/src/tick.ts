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
import { RESEND_API_KEY } from "./params.js";
import { holdRun, requestApproval } from "./store/tokens.js";

export type TickDeps = NotifyDeps;

export interface Tally {
  drafted: number;
  requested: number;
  /** Runs released to tenants. */
  sent: number;
  held: number;
  reminded: number;
}

export interface TickOptions {
  /** Only these orgs (tests, plan §9.3). Every org when absent. */
  readonly orgIds?: readonly string[];
}

export async function runTick(deps: TickDeps, opts: TickOptions = {}): Promise<Tally> {
  const now = deps.now();
  const tally: Tally = { drafted: 0, requested: 0, sent: 0, held: 0, reminded: 0 };
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

  // 1. Draft the periods that are due, for every org.
  await each(await orgIdsToTick(opts.orgIds), async (orgId) => {
    const [{ org, tenancies }, runPeriods] = await Promise.all([billingOf(orgId), runPeriodsOf(orgId)]);
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
    const failures = await sendToTenants(deps, run.orgId, outcome.invoices);
    if (outcome.invoices.length > 0) {
      await sendDispatch(deps, run.orgId, await orgOf(run.orgId), run.period, dispatchLines(outcome.invoices, failures));
    }
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
export function makeTick(deps: TickDeps) {
  return onSchedule({ schedule: "every 60 minutes", retryCount: 3, timeoutSeconds: 540, secrets: [RESEND_API_KEY] }, async () => {
    await runTick(deps);
  });
}
