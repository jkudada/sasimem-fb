/**
 * Every email the server sends, each through the email log (plan §6.6). The
 * callables, the approval page and the tick call these after their transaction has
 * committed, and only the caller that won the compare-and-set does.
 */
import type { InvoiceDocument, Period, Toea } from "@sasimem/core";
import type { Timestamp } from "firebase-admin/firestore";
import { bucket } from "./admin.js";
import { sendLogged } from "./mail/log.js";
import type { Mailer } from "./mail/mailer.js";
import { type DispatchLine, approvalDigest, dispatchNotice, freshLink, heldNotice, tenantInvoice, tenantReminder } from "./mail/templates.js";
import { type OrgDoc, refs } from "./store/runs.js";

export interface NotifyDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  readonly newToken: () => string;
  /** The Hosting origin approval links point at. */
  readonly appUrl: () => string;
}

const linkFor = (deps: NotifyDeps, token: string) => `${deps.appUrl()}/a/${token}`;
const logged = (deps: NotifyDeps) => ({ mailer: deps.mailer, now: deps.now() });

async function runFacts(orgId: string, period: Period) {
  const run = (await refs(orgId).run(period).get()).data() ?? {};
  return { count: run["invoiceCount"] as number, totalToea: run["totalToea"] as Toea, sendAt: (run["sendAt"] as Timestamp).toDate() };
}

/** The digest for a run just asked for approval. late: it was already held when asked. */
export async function sendDigest(deps: NotifyDeps, orgId: string, org: OrgDoc, period: Period, token: string, late = false): Promise<void> {
  const run = await runFacts(orgId, period);
  await sendLogged(logged(deps), { orgId, kind: "approvalDigest", runPeriod: period }, approvalDigest({
    to: org.email, orgName: org.name, period, ...run, link: linkFor(deps, token), timezone: org.timezone, late,
  }));
}

/** Always to the org's address on file (plan §6.1), never one a visitor supplies. */
export async function sendFreshLink(deps: NotifyDeps, orgId: string, org: OrgDoc, period: Period, token: string): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "freshLink", runPeriod: period }, freshLink({ to: org.email, orgName: org.name, period, link: linkFor(deps, token) }));
}

export async function sendHeld(deps: NotifyDeps, orgId: string, org: OrgDoc, period: Period, token: string): Promise<void> {
  const { sendAt } = await runFacts(orgId, period);
  await sendLogged(logged(deps), { orgId, kind: "held", runPeriod: period }, heldNotice({
    to: org.email, orgName: org.name, period, link: linkFor(deps, token), sendAt, timezone: org.timezone,
  }));
}

export async function sendDispatch(deps: NotifyDeps, orgId: string, org: OrgDoc, period: Period, lines: readonly DispatchLine[]): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "dispatch", runPeriod: period }, dispatchNotice({ to: org.email, orgName: org.name, period, lines }));
}

/** An issued invoice's email, from its frozen snapshot and its stored PDF only. */
async function invoiceMail(invoice: InvoiceDocument, make: typeof tenantInvoice) {
  if (invoice.snapshot === null || invoice.number === null || invoice.pdfPath === "") throw new Error("an invoice is emailed only once it is approved and has its PDF");
  const [pdf] = await bucket().file(invoice.pdfPath).download();
  return make({
    snapshot: invoice.snapshot, number: invoice.number, documentTitle: invoice.documentTitle, period: invoice.period,
    totalToea: invoice.totalToea, dueDate: invoice.dueDate, paymentReference: invoice.paymentReference, pdf,
  });
}

export async function sendTenantInvoice(deps: NotifyDeps, orgId: string, invoiceId: string, invoice: InvoiceDocument): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "tenantInvoice", runPeriod: invoice.period, invoiceId }, await invoiceMail(invoice, tenantInvoice));
}

export async function sendReminder(deps: NotifyDeps, orgId: string, invoiceId: string, invoice: InvoiceDocument): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "reminder", runPeriod: invoice.period, invoiceId }, await invoiceMail(invoice, tenantReminder));
}
