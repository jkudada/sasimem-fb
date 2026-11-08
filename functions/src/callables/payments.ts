/**
 * After sending (plan §6.2): paid ticks, the reminder switch, void, the PDF,
 * "email again" and the CSV export. Each re-checks that the caller owns the org.
 */
import {
  type CalendarDate, type CsvRow, type InvoiceDocument, type Period,
  exportRangeProblem, invoicesCsv, localDate, paidNoteProblem, parsePeriod, voidReasonProblem,
} from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { bucket } from "../admin.js";
import { pdfFilename } from "../mail/templates.js";
import { type NotifyDeps, sendInvoiceAgain } from "../notify.js";
import { mailSecret } from "../params.js";
import { setPaid, setRemindersPaused, setUnpaid, voidInvoice } from "../store/payments.js";
import { type OrgDoc, refs } from "../store/runs.js";
import { ownerOrg, uidOf } from "./auth.js";
import { invoiceIdOf, plainly } from "./edits.js";

function textOf(request: CallableRequest<unknown>, field: string): string {
  const v = (request.data as Record<string, unknown>)[field];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new HttpsError("invalid-argument", "That does not look like text.");
  return v;
}

function checked(problem: string | null): void {
  if (problem !== null) throw new HttpsError("invalid-argument", problem);
}

async function issuedInvoice(orgId: string, id: string): Promise<InvoiceDocument> {
  const snap = await refs(orgId).invoice(id).get();
  if (!snap.exists) throw new HttpsError("not-found", "That invoice no longer exists. Reload and try again.");
  return snap.data() as InvoiceDocument;
}

const periodArg = (request: CallableRequest<unknown>, field: string): Period => {
  try {
    return parsePeriod(textOf(request, field));
  } catch {
    throw new HttpsError("invalid-argument", "Choose a month for each end of the export.");
  }
};

const ok = { ok: true as const };

export function makePaymentCallables(deps: NotifyDeps) {
  const paying = <T>(act: (orgId: string, invoiceId: string, request: CallableRequest<unknown>) => Promise<T>, opts = {}) =>
    onCall<unknown, Promise<T>>(opts, async (request) => {
      const orgId = await ownerOrg(request);
      return act(orgId, invoiceIdOf(request), request);
    });

  return {
    markPaid: paying(async (orgId, id, request) => {
      const note = textOf(request, "note").trim();
      checked(paidNoteProblem(note));
      await plainly(() => setPaid(orgId, id, { actor: uidOf(request), now: deps.now(), note }));
      return ok;
    }),

    markUnpaid: paying(async (orgId, id, request) => {
      await plainly(() => setUnpaid(orgId, id, { actor: uidOf(request), now: deps.now() }));
      return ok;
    }),

    pauseReminders: paying(async (orgId, id, request) => {
      const paused = (request.data as { paused?: unknown }).paused;
      if (typeof paused !== "boolean") throw new HttpsError("invalid-argument", "Say whether to pause or resume.");
      await plainly(() => setRemindersPaused(orgId, id, paused, { actor: uidOf(request), now: deps.now() }));
      return ok;
    }),

    voidInvoice: paying(async (orgId, id, request) => {
      const reason = textOf(request, "reason").trim();
      checked(voidReasonProblem(reason));
      await plainly(() => voidInvoice(orgId, id, { actor: uidOf(request), now: deps.now(), reason }));
      return ok;
    }),

    /**
     * The frozen PDF itself (3-150 KB), for the app to open from a local blob. Nothing
     * reusable leaves the server - no signed URL to forward - and no signing role is needed.
     */
    invoicePdf: paying(async (orgId, id) => {
      const invoice = await issuedInvoice(orgId, id);
      if (invoice.pdfPath === "") throw new HttpsError("failed-precondition", "This invoice has no PDF yet.");
      const [pdf] = await bucket().file(invoice.pdfPath).download();
      return { filename: pdfFilename(invoice.number ?? id), base64: pdf.toString("base64") };
    }),

    resendInvoice: paying(async (orgId, id) => {
      const invoice = await issuedInvoice(orgId, id);
      if (invoice.status !== "sent" && invoice.status !== "paid") throw new HttpsError("failed-precondition", "Only an invoice that has been sent can be emailed again.");
      await sendInvoiceAgain(deps, orgId, id, invoice);
      return { ok: true as const, message: `Emailed ${invoice.number ?? "the invoice"} to ${invoice.snapshot?.tenantEmail ?? "the tenant"} again.` };
    }, { secrets: [mailSecret()] }),

    exportCsv: onCall<unknown, Promise<{ filename: string; csv: string }>>(async (request) => {
      const orgId = await ownerOrg(request);
      const [from, to] = [periodArg(request, "from"), periodArg(request, "to")];
      checked(exportRangeProblem(from, to));
      const r = refs(orgId);
      const [org, snap] = await Promise.all([r.org.get(), r.org.collection("invoices").where("period", ">=", from).where("period", "<=", to).get()]);
      const timezone = (org.data() as OrgDoc).timezone;
      const rows: CsvRow[] = snap.docs
        .map((d) => d.data() as InvoiceDocument & { voidReason?: string; numberSeq: number | null })
        .filter((i) => i.number !== null)
        .sort((a, b) => (a.numberSeq ?? 0) - (b.numberSeq ?? 0))
        .map((i) => ({
          number: i.number ?? "", issueDate: i.issueDate, dueDate: i.dueDate, period: i.period,
          tenantName: i.snapshot?.tenantName ?? i.tenantName, unitLabel: i.snapshot?.unitLabel ?? i.unitLabel, paymentReference: i.paymentReference,
          subtotalToea: i.subtotalToea, gstToea: i.gstToea, totalToea: i.totalToea, status: i.status,
          paidOn: (i.paidAt as unknown) instanceof Timestamp ? localDate((i.paidAt as unknown as Timestamp).toDate(), timezone) : null as CalendarDate | null,
          paidNote: i.paidNote, voidReason: i.voidReason ?? "",
        }));
      return { filename: `invoices-${from}-to-${to}.csv`, csv: invoicesCsv(rows) };
    }),
  };
}
