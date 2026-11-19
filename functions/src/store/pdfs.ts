/**
 * PDFs after approval (plan §6.3 step 2, I5). Each approved invoice is rendered once,
 * from its frozen snapshot, and uploaded with ifGenerationMatch: 0, so an existing
 * PDF is never overwritten: a 412 means it is already there, and only the path is
 * recorded. The tick (step 5) calls this again before sending, and never sends
 * without a PDF.
 */
import type { InvoiceDocument, Period } from "@sasimem/core";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { bucket, db } from "../admin.js";
import { renderInvoicePdf } from "../pdf.js";
import { type StoredCreditNote, creditNotePdfPath, creditNotesOf } from "./creditNotes.js";
import { refs } from "./runs.js";

export const pdfPathOf = (orgId: string, invoiceId: string): string => `invoices/${orgId}/${invoiceId}.pdf`;

const alreadyExists = (e: unknown): boolean => typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === 412;

/** Render and store every approved invoice of a period that has no PDF yet. Returns how many it did. */
export async function renderMissingPdfs(orgId: string, period: Period): Promise<number> {
  const r = refs(orgId);
  const missing = (await r.invoicesOf(period).where("pdfPath", "==", "").get()).docs.filter((d) => d.get("status") === "approved");
  const logo = logoCache();
  for (const snap of missing) await renderOne(orgId, snap, logo);
  return missing.length;
}

/** One invoice's PDF, if it has none yet: a one-off just issued (G2a). True if it rendered. */
export async function renderPdfOf(orgId: string, invoiceId: string): Promise<boolean> {
  const snap = await refs(orgId).invoice(invoiceId).get();
  if (!snap.exists || snap.get("pdfPath") !== "") return false;
  await renderOne(orgId, snap, logoCache());
  return true;
}

/** One download per logo, however many invoices. A lost logo falls back to the monogram. */
function logoCache(): (path: string | null) => Promise<Buffer | null> {
  const logos = new Map<string, Promise<Buffer | null>>();
  return (path) => {
    if (path === null) return Promise.resolve(null);
    let got = logos.get(path);
    if (got === undefined) logos.set(path, (got = bucket().file(path).download().then(([b]) => b, () => null)));
    return got;
  };
}

async function renderOne(orgId: string, snap: DocumentSnapshot, logo: (path: string | null) => Promise<Buffer | null>): Promise<void> {
  const invoice = snap.data() as InvoiceDocument;
  const path = pdfPathOf(orgId, snap.id);
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    const pdf = await renderInvoicePdf(invoice, await logo(invoice.snapshot?.org.logoPath ?? null));
    try {
      await file.save(pdf, { contentType: "application/pdf", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (e) {
      if (!alreadyExists(e)) throw e;
    }
  }
  await db().runTransaction(async (tx) => {
    const fresh = await tx.get(snap.ref);
    if (fresh.get("pdfPath") === "") tx.update(snap.ref, { pdfPath: path });
  });
}

/** A credit note as the invoice layouts print it: its own number, date, lines and totals on the invoice's frozen look. */
function printable(cn: StoredCreditNote): InvoiceDocument {
  const { notes: _notes, ...snapshot } = cn.snapshot; // the invoice's own notes are not the credit note's
  return {
    tenancyId: "", period: cn.issueDate.slice(0, 7) as Period, issueDate: cn.issueDate, dueDate: cn.issueDate, paymentReference: "",
    lines: cn.lines, subtotalToea: cn.subtotalToea, gstToea: cn.gstToea, totalToea: cn.totalToea,
    documentTitle: cn.documentTitle as unknown as InvoiceDocument["documentTitle"],
    tenantId: cn.customerId, tenantName: cn.customerName, unitLabel: "", status: "sent", numberSeq: cn.numberSeq, number: cn.number,
    snapshot, pdfPath: "", sentAt: null, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
  };
}

export const renderCreditNotePdf = (cn: StoredCreditNote, logo: Buffer | null, opts: { compress?: boolean } = {}): Promise<Buffer> =>
  renderInvoicePdf(printable(cn), logo, { ...opts, credit: { invoiceNumber: cn.invoiceNumber, reason: cn.reason, appliedToea: cn.appliedToea, creditToea: cn.creditToea } });

/** A credit note's PDF, once (G2c), stored as an invoice's is. Returns the credit note with its path. */
export async function creditNotePdfOf(orgId: string, id: string): Promise<StoredCreditNote> {
  const ref = creditNotesOf(orgId).doc(id);
  const cn = (await ref.get()).data() as StoredCreditNote;
  if (cn.pdfPath !== "") return cn;
  const path = creditNotePdfPath(orgId, id);
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    const pdf = await renderCreditNotePdf(cn, await logoCache()(cn.snapshot.org.logoPath));
    try {
      await file.save(pdf, { contentType: "application/pdf", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (e) {
      if (!alreadyExists(e)) throw e;
    }
  }
  await ref.update({ pdfPath: path });
  return { ...cn, pdfPath: path };
}
