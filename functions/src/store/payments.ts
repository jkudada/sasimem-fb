/**
 * After sending (plan §3.5, §6.2): paid ticks, the reminder switch and void. Each is a
 * transaction on one invoice with an events entry. None of them emails anyone.
 */
import { type InvoiceDocument, canVoid, markPaid, markUnpaid, NotAllowed } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { Refused } from "./edits.js";
import { refs } from "./runs.js";

const date = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

async function onInvoice(orgId: string, id: string, change: (inv: InvoiceDocument & Record<string, unknown>) => { update: Record<string, unknown>; event?: { kind: string; note: string } } | null, actor: string, now: Date): Promise<void> {
  const r = refs(orgId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(r.invoice(id));
    if (!snap.exists) throw new Refused("That invoice no longer exists. Reload and try again.");
    const result = change(snap.data() as InvoiceDocument & Record<string, unknown>);
    if (result === null) return;
    tx.update(snap.ref, result.update);
    if (result.event !== undefined) tx.create(r.events.doc(), { actor, kind: result.event.kind, at: Timestamp.fromDate(now), target: `invoices/${id}`, note: result.event.note });
  });
}

export function setPaid(orgId: string, id: string, req: { actor: string; now: Date; note: string }): Promise<void> {
  return onInvoice(orgId, id, (inv) => {
    if (inv.status === "paid") return null; // again: a no-op that keeps the first date
    let next;
    try {
      next = markPaid({ status: inv.status, paidAt: date(inv.paidAt) }, req.now);
    } catch (e) {
      if (e instanceof NotAllowed) throw new Refused("Only an invoice that has been sent can be marked paid.");
      throw e;
    }
    return { update: { status: next.status, paidAt: Timestamp.fromDate(req.now), paidNote: req.note }, event: { kind: "invoicePaid", note: req.note } };
  }, req.actor, req.now);
}

export function setUnpaid(orgId: string, id: string, req: { actor: string; now: Date }): Promise<void> {
  return onInvoice(orgId, id, (inv) => {
    if (inv.status !== "paid") return null;
    const next = markUnpaid({ status: inv.status, paidAt: date(inv.paidAt) });
    return { update: { status: next.status, paidAt: null, paidNote: "" }, event: { kind: "invoiceUnpaid", note: "" } }; // remindedAt stays (I8)
  }, req.actor, req.now);
}

export function setRemindersPaused(orgId: string, id: string, paused: boolean, req: { actor: string; now: Date }): Promise<void> {
  return onInvoice(orgId, id, () => ({ update: { remindersPaused: paused } }), req.actor, req.now);
}

export function voidInvoice(orgId: string, id: string, req: { actor: string; now: Date; reason: string }): Promise<void> {
  return onInvoice(orgId, id, (inv) => {
    if (inv.status === "void") return null;
    if (inv.status === "draft" || inv.status === "excluded") throw new Refused("A draft is not voided: leave it out of the month instead.");
    if (!canVoid(inv.status)) throw new Refused("This invoice cannot be voided.");
    // The number stays issued: numbers are never reused (I3).
    return { update: { status: "void", voidReason: req.reason, voidedAt: Timestamp.fromDate(req.now), voidedBy: req.actor }, event: { kind: "invoiceVoided", note: req.reason } };
  }, req.actor, req.now);
}
