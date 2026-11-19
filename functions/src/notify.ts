/**
 * Every email the server sends, each through the email log (plan §6.6). The
 * callables, the approval page and the tick call these after their transaction has
 * committed, and only the caller that won the compare-and-set does.
 */
import { CLASSIC, type InvoiceDocument, type InvoiceSnapshot, type InvoiceTemplate, METHOD_LABELS, type Period, type Toea, customerOf, sourceOf, templateFor } from "@sasimem/core";
import type { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { bucket } from "./admin.js";
import { sendLogged } from "./mail/log.js";
import type { Mailer } from "./mail/mailer.js";
import { type DispatchLine, approvalDigest, dispatchNotice, freshLink, freshTrackingLink, heldNotice, receipt, tenantInvoice, tenantReminder } from "./mail/templates.js";
import { prepareLogo } from "./pdf.js";
import type { StoredPayment } from "./store/receipts.js";
import { type OrgDoc, refs } from "./store/runs.js";

export interface NotifyDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  readonly newToken: () => string;
  /** The Hosting origin approval links point at. */
  readonly appUrl: () => string;
}

/**
 * For a callable whose whole job is one email: the provider refusing it becomes a clear
 * error instead of INTERNAL. The email log already holds the refusal; the error log line
 * fires the alert. "aborted", not "unavailable": the app reads "unavailable" as offline.
 */
export async function orRefused<T>(send: Promise<T>): Promise<T> {
  try {
    return await send;
  } catch (e) {
    logger.error("email refused", { error: e instanceof Error ? e.message : String(e) });
    throw new HttpsError("aborted", "The email could not be sent. Try again in a few minutes.");
  }
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

export async function sendDispatch(deps: NotifyDeps, orgId: string, org: OrgDoc, period: Period, lines: readonly DispatchLine[], trackingToken: string): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "dispatch", runPeriod: period }, dispatchNotice({ to: org.email, orgName: org.name, period, lines, trackLink: linkFor(deps, trackingToken) }));
}

/** A sent month's fresh link: the tracking page, not approval. Always to the org's address on file. */
export async function sendFreshTrackingLink(deps: NotifyDeps, orgId: string, org: OrgDoc, period: Period, token: string): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "freshLink", runPeriod: period }, freshTrackingLink({ to: org.email, orgName: org.name, period, link: linkFor(deps, token) }));
}

/** An issued invoice's email, from its frozen snapshot and its stored PDF only. */
async function invoiceMail(invoice: InvoiceDocument, make: typeof tenantInvoice) {
  if (invoice.snapshot === null || invoice.number === null || invoice.pdfPath === "") throw new Error("an invoice is emailed only once it is approved and has its PDF");
  const [pdf] = await bucket().file(invoice.pdfPath).download();
  return make({
    snapshot: invoice.snapshot, number: invoice.number, documentTitle: invoice.documentTitle, period: invoice.period,
    totalToea: invoice.totalToea, dueDate: invoice.dueDate, paymentReference: invoice.paymentReference, pdf,
    logo: await emailLogo(invoice.snapshot),
    oneOff: sourceOf(invoice).kind !== "rent",
    ...(invoice.amountPaidToea === undefined ? {} : { amountPaidToea: invoice.amountPaidToea }),
  });
}

/**
 * The logo for the email's header, as the PDF prepares it, when the frozen template shows
 * it. A lost or unreadable logo gives initials instead; it never stops an invoice going.
 */
async function emailLogo(snapshot: InvoiceSnapshot): Promise<Buffer | null> {
  const path = snapshot.org.logoPath;
  if ((snapshot.template ?? CLASSIC).mark !== "logo" || path === null) return null;
  try {
    const [bytes] = await bucket().file(path).download();
    return await prepareLogo(bytes);
  } catch {
    return null;
  }
}

export async function sendTenantInvoice(deps: NotifyDeps, orgId: string, invoiceId: string, invoice: InvoiceDocument): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "tenantInvoice", runPeriod: invoice.period, invoiceId }, await invoiceMail(invoice, tenantInvoice));
}

/** The landlord asked for it: e.g. after correcting an address the provider refused. */
export async function sendInvoiceAgain(deps: NotifyDeps, orgId: string, invoiceId: string, invoice: InvoiceDocument): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "tenantInvoiceAgain", runPeriod: invoice.period, invoiceId }, await invoiceMail(invoice, tenantInvoice));
}

export async function sendReminder(deps: NotifyDeps, orgId: string, invoiceId: string, invoice: InvoiceDocument): Promise<void> {
  await sendLogged(logged(deps), { orgId, kind: "reminder", runPeriod: invoice.period, invoiceId }, await invoiceMail(invoice, tenantReminder));
}

/**
 * A payment's receipt (G2b), to the customer as they are on file now and their copy-to,
 * in the org's default template's colours. It states the balances the payment left, as
 * stored with it. `again`: the owner asked, so it is not once-only. Returns the address.
 */
export async function sendReceipt(deps: NotifyDeps, orgId: string, paymentId: string, payment: StoredPayment, again = false): Promise<string> {
  const r = refs(orgId);
  const [orgSnap, customerSnap, templates] = await Promise.all([r.org.get(), r.tenant(payment.customerId).get(), r.templates.get()]);
  const org = orgSnap.data() as OrgDoc;
  const customer = customerOf(customerSnap.data() ?? {});
  if (customer.email === "") throw new Error("the customer has no email address");
  const t = templateFor({ org }, Object.fromEntries(templates.docs.map((d) => [d.id, d.data() as InvoiceTemplate])));
  await sendLogged(logged(deps), { orgId, kind: again ? "receiptAgain" : "receipt", paymentId }, receipt({
    to: customer.email, cc: customer.ccEmails, orgName: org.name, orgEmail: org.email, accent: t.accent, font: t.font,
    customerName: customer.name, receiptNumber: payment.receiptNumber, receivedOn: payment.receivedOn, amountToea: payment.amountToea,
    method: METHOD_LABELS[payment.method], reference: payment.reference,
    applied: payment.allocations.map((a) => ({ number: a.number, amountToea: a.amountToea, balanceToea: a.balanceAfterToea })), creditToea: payment.creditToea,
  }));
  return customer.email;
}
