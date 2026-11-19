/**
 * Recording and undoing payments (docs/PLAN-GENERAL-INVOICING.md AR-5, AR-10; G2b). One
 * transaction reads the customer and every invoice the payment is applied to, re-checks
 * the allocation with core against those balances (so two payments at once cannot overpay
 * an invoice), numbers the receipt (RCT-) and writes the invoices, the payment, the
 * customer's credit (G2c) and an event. The receipt email follows the commit, as for invoices.
 * Only money received gets a receipt: a payment that only uses credit has no number.
 */
import {
  type CalendarDate, type InvoiceDocument, type OpenInvoice, type PaymentInput, type Toea,
  applied, creditOf, customerOf, documentNumber, formatKina, hasFeature, localDate, nextNumberOf, paymentProblems,
} from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { changeCredit, creditIn, creditOf as creditRefOf } from "./creditNotes.js";
import { Refused } from "./edits.js";
import { type OrgDoc, refs } from "./runs.js";

/** A payment as stored: orgs/{orgId}/payments/{id}, written only here. */
export interface StoredPayment {
  readonly customerId: string;
  readonly customerName: string;
  readonly receivedOn: CalendarDate;
  readonly amountToea: Toea;
  readonly method: PaymentInput["method"];
  readonly reference: string;
  readonly note: string;
  /** What each invoice got, and what it still owed after: the receipt states both. */
  readonly allocations: readonly { readonly invoiceId: string; readonly number: string; readonly amountToea: Toea; readonly balanceAfterToea: Toea }[];
  /** Made by this payment, and (G2c) used by it; absent on payments from before G2c. */
  readonly creditToea: Toea;
  readonly creditUsedToea?: Toea;
  /** "" and 0 when nothing was received (it only used credit): no receipt. */
  readonly receiptNumber: string;
  readonly receiptSeq: number;
  readonly status: "recorded" | "undone";
  readonly recordedAt: Timestamp;
  readonly recordedBy: string;
  readonly undoneAt: Timestamp | null;
  readonly undoneBy: string | null;
  readonly undoReason: string;
}

export type RecordOutcome =
  | { readonly kind: "recorded"; readonly payment: StoredPayment }
  | { readonly kind: "alreadyRecorded"; readonly payment: StoredPayment }
  | { readonly kind: "notEnabled" }
  | { readonly kind: "refused"; readonly message: string };

const paymentsOf = (orgId: string) => refs(orgId).org.collection("payments");

/** An invoice as core's payment rules see it. */
const openOf = (id: string, d: InvoiceDocument): OpenInvoice => ({
  id, number: d.number ?? "", customerId: d.tenantId, status: d.status, dueDate: d.dueDate, totalToea: d.totalToea,
  ...(d.amountPaidToea === undefined ? {} : { amountPaidToea: d.amountPaidToea }),
  ...(d.creditedToea === undefined ? {} : { creditedToea: d.creditedToea }),
});

/** What a payment did to the customer's credit: what it made less what it used. */
const creditChange = (p: Pick<StoredPayment, "creditToea" | "creditUsedToea">): number => p.creditToea - (p.creditUsedToea ?? 0);

export async function recordPayment(orgId: string, paymentId: string, input: PaymentInput, req: { readonly actor: string; readonly now: Date }): Promise<RecordOutcome> {
  const r = refs(orgId);
  const paymentRef = paymentsOf(orgId).doc(paymentId);
  return db().runTransaction(async (tx): Promise<RecordOutcome> => {
    const existing = await tx.get(paymentRef);
    if (existing.exists) return { kind: "alreadyRecorded", payment: existing.data() as StoredPayment };

    const ids = [...new Set(input.allocations.map((a) => a.invoiceId))];
    const customerKey = input.customerId === "" ? "-" : input.customerId;
    const creditRef = creditRefOf(orgId, customerKey);
    const [orgSnap, counterSnap, customerSnap, creditSnap, ...invoiceSnaps] = await tx.getAll(
      r.org, r.counter, r.tenant(customerKey), creditRef, ...ids.map((id) => r.invoice(id)),
    );
    const org = orgSnap?.data() as OrgDoc & { readonly modules?: unknown; readonly features?: unknown };
    if (!hasFeature(org, "oneOff")) return { kind: "notEnabled" };
    if (input.customerId !== "" && customerSnap?.exists !== true) return { kind: "refused", message: "That customer is not there any more. Reload and try again." };

    const open = invoiceSnaps.filter((s) => s.exists).map((s) => openOf(s.id, s.data() as InvoiceDocument));
    const credit = creditIn(creditSnap);
    const problem = Object.values(paymentProblems(input, open, localDate(req.now, org.timezone), credit))[0];
    if (problem !== undefined) return { kind: "refused", message: problem };

    const received = input.amountToea > 0;
    const seq = received ? nextNumberOf(counterSnap?.data() ?? {}, "receipt") : 0;
    const receiptNumber = received ? documentNumber("receipt", seq, org) : "";
    const paidBy = received ? `Receipt ${receiptNumber}` : "Credit";
    const at = Timestamp.fromDate(req.now);
    const allocations = input.allocations.map((a) => {
      const invoice = open.find((i) => i.id === a.invoiceId) as OpenInvoice;
      const next = applied(invoice, a.amountToea);
      tx.update(r.invoice(a.invoiceId), {
        amountPaidToea: next.amountPaidToea, status: next.status,
        ...(next.status === "paid" ? { paidAt: at, paidNote: paidBy } : {}),
      });
      return { invoiceId: a.invoiceId, number: invoice.number, amountToea: a.amountToea, balanceAfterToea: (invoice.totalToea - next.amountPaidToea) as Toea };
    });

    const customerName = customerOf(customerSnap?.data() ?? {}).name;
    const payment: StoredPayment = {
      customerId: input.customerId, customerName, receivedOn: input.receivedOn, amountToea: input.amountToea, method: input.method,
      reference: input.reference.trim(), note: input.note.trim(), allocations, creditToea: creditOf(input),
      ...((input.creditUsedToea ?? 0) > 0 ? { creditUsedToea: input.creditUsedToea } : {}),
      receiptNumber, receiptSeq: seq, status: "recorded", recordedAt: at, recordedBy: req.actor, undoneAt: null, undoneBy: null, undoReason: "",
    };
    tx.create(paymentRef, payment);
    changeCredit(tx, creditRef, credit, creditChange(payment), customerName, at);
    if (received) tx.set(r.counter, { nextReceiptNumber: seq + 1 }, { merge: true });
    const used = (input.creditUsedToea ?? 0) > 0 ? ` and ${formatKina(input.creditUsedToea as Toea)} of credit` : "";
    tx.create(r.events.doc(), { actor: req.actor, kind: "paymentRecorded", at, target: `payments/${paymentId}`, note: `${receiptNumber || "No receipt"}, ${formatKina(input.amountToea)}${used}, ${customerName}` });
    return { kind: "recorded", payment };
  });
}

/**
 * Undo a mistaken payment: its allocations come off the invoices (a paid one is sent
 * again), the credit it used goes back and the credit it made comes off, and it stays,
 * marked undone, keeping its receipt number. Nobody is emailed. False when it was already
 * undone. Refused when the credit it made has been used since.
 */
export async function undoPayment(orgId: string, paymentId: string, req: { readonly actor: string; readonly now: Date; readonly reason: string }): Promise<boolean> {
  const r = refs(orgId);
  const paymentRef = paymentsOf(orgId).doc(paymentId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(paymentRef);
    if (!snap.exists) throw new Refused("That payment is not there any more. Reload and try again.");
    const payment = snap.data() as StoredPayment;
    if (payment.status === "undone") return false;
    const creditRef = creditRefOf(orgId, payment.customerId);
    const [creditSnap, ...invoices] = await tx.getAll(creditRef, ...payment.allocations.map((a) => r.invoice(a.invoiceId)));
    const credit = creditIn(creditSnap);
    if (credit - creditChange(payment) < 0) {
      throw new Refused(`${formatKina(payment.creditToea)} of credit came from this payment, and some of it has been used since. Undo the payment that used it first.`);
    }
    const at = Timestamp.fromDate(req.now);
    payment.allocations.forEach((a, n) => {
      const s = invoices[n];
      if (s?.exists !== true) throw new Refused(`${a.number} is not there any more, so this payment cannot be undone.`);
      const next = applied(openOf(s.id, s.data() as InvoiceDocument), (-a.amountToea) as Toea);
      tx.update(s.ref, { amountPaidToea: next.amountPaidToea, status: next.status, ...(next.status === "sent" ? { paidAt: null, paidNote: "" } : {}) });
    });
    tx.update(paymentRef, { status: "undone", undoneAt: at, undoneBy: req.actor, undoReason: req.reason });
    changeCredit(tx, creditRef, credit, -creditChange(payment), payment.customerName, at);
    tx.create(r.events.doc(), { actor: req.actor, kind: "paymentUndone", at, target: `payments/${paymentId}`, note: `${payment.receiptNumber || "No receipt"}: ${req.reason}` });
    return true;
  });
}

export async function storedPayment(orgId: string, paymentId: string): Promise<StoredPayment | null> {
  const snap = await paymentsOf(orgId).doc(paymentId).get();
  return snap.exists ? (snap.data() as StoredPayment) : null;
}
