/**
 * Releasing an approved run to its tenants (plan §6.4 step 3, I6). One
 * compare-and-set moves the run and its invoices approved → sent; only the tick that
 * wins emails anyone, so two overlapping ticks never double-send. Sending follows the
 * commit: a crash can lose an email (the log shows it missing), never repeat one.
 */
import { type InvoiceDocument, type Period, type RunStatus, releaseDue } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { refs } from "./runs.js";

export type ReleaseOutcome =
  | { readonly released: true; readonly invoices: readonly (InvoiceDocument & { readonly id: string })[] }
  | { readonly released: false; readonly reason: "notDue" | "missingPdf" };

export async function releaseRun(orgId: string, period: Period, now: Date): Promise<ReleaseOutcome> {
  const r = refs(orgId);
  return db().runTransaction(async (tx) => {
    const run = await tx.get(r.run(period));
    const status = run.get("status") as RunStatus | undefined;
    if (status === undefined || !releaseDue({ status, sendAt: (run.get("sendAt") as Timestamp).toDate() }, now)) return { released: false, reason: "notDue" };
    const approved = (await tx.get(r.invoicesOf(period).where("status", "==", "approved"))).docs;
    // Never send an invoice without its PDF: the caller renders missing ones first.
    if (approved.some((d) => d.get("pdfPath") === "")) return { released: false, reason: "missingPdf" };
    const at = Timestamp.fromDate(now);
    for (const d of approved) tx.update(d.ref, { status: "sent", sentAt: at }); // ≤ 20 per landlord, far under 500
    tx.update(r.run(period), { status: "sent", sentAt: at });
    return { released: true, invoices: approved.map((d) => ({ ...(d.data() as InvoiceDocument), status: "sent" as const, id: d.id })) };
  });
}
