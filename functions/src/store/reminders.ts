/**
 * Reminders (plan §3.6, §6.4 step 5, I8). An invoice is reminded at most once, ever:
 * remindedAt is set in the compare-and-set that claims the send, and never cleared.
 */
import { type BillingOrg, type InvoiceDocument, type ReminderCandidate, reminderDue } from "@sasimem/core";
import { type DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";

type ReminderOrg = Pick<BillingOrg, "timezone" | "reminderMode" | "reminderAfterDays">;

export interface Unreminded {
  readonly orgId: string;
  readonly ref: DocumentReference;
}

/** Sent invoices with no reminder yet and reminders not paused, across orgs (an indexed collection-group query). */
export async function unremindedInvoices(orgIds?: readonly string[]): Promise<Unreminded[]> {
  const snap = await db().collectionGroup("invoices")
    .where("status", "==", "sent").where("remindedAt", "==", null).where("remindersPaused", "==", false).get();
  const all = snap.docs.map((d) => ({ orgId: d.ref.parent.parent?.id ?? "", ref: d.ref }));
  return orgIds === undefined ? all : all.filter((i) => orgIds.includes(i.orgId));
}

const asCandidate = (d: InvoiceDocument & Record<string, unknown>): ReminderCandidate => {
  const date = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);
  return { status: d.status, dueDate: d.dueDate, sentAt: date(d.sentAt), paidAt: date(d.paidAt), remindedAt: date(d.remindedAt), remindersPaused: d.remindersPaused };
};

/** Claim one invoice's reminder if it has earned it. Returns the invoice to email, or null if not due or another tick won. */
export async function claimReminder(ref: DocumentReference, org: ReminderOrg, now: Date): Promise<InvoiceDocument | null> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const invoice = snap.data() as (InvoiceDocument & Record<string, unknown>) | undefined;
    if (invoice === undefined || !reminderDue({ invoice: asCandidate(invoice), org, now })) return null;
    tx.update(ref, { remindedAt: Timestamp.fromDate(now) });
    return invoice;
  });
}
