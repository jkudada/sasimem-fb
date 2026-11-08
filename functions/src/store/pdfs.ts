/**
 * PDFs after approval (plan §6.3 step 2, I5). Each approved invoice is rendered once,
 * from its frozen snapshot, and uploaded with ifGenerationMatch: 0, so an existing
 * PDF is never overwritten: a 412 means it is already there, and only the path is
 * recorded. The tick (step 5) calls this again before sending, and never sends
 * without a PDF.
 */
import type { InvoiceDocument, Period } from "@sasimem/core";
import { bucket, db } from "../admin.js";
import { renderInvoicePdf } from "../pdf.js";
import { refs } from "./runs.js";

export const pdfPathOf = (orgId: string, invoiceId: string): string => `invoices/${orgId}/${invoiceId}.pdf`;

const alreadyExists = (e: unknown): boolean => typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === 412;

/** Render and store every approved invoice of a period that has no PDF yet. Returns how many it did. */
export async function renderMissingPdfs(orgId: string, period: Period): Promise<number> {
  const r = refs(orgId);
  const missing = (await r.invoicesOf(period).where("pdfPath", "==", "").get()).docs.filter((d) => d.get("status") === "approved");
  const logos = new Map<string, Promise<Buffer | null>>(); // one download per logo, however many invoices
  const logo = (path: string | null) => {
    if (path === null) return Promise.resolve(null);
    let got = logos.get(path);
    if (got === undefined) logos.set(path, (got = bucket().file(path).download().then(([b]) => b, () => null))); // a lost logo falls back to the monogram
    return got;
  };

  let rendered = 0;
  for (const snap of missing) {
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
    rendered++;
  }
  return rendered;
}
