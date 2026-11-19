/**
 * Credit notes (docs/PLAN-GENERAL-INVOICING.md AR-3; G2c). One transaction reads the
 * invoice, re-checks the credit note with core against what earlier ones took, numbers it
 * (CN-), freezes it from the invoice's own snapshot (I5), and writes the invoice's
 * credited amounts, the credit note, the customer's credit and an event. The PDF and the
 * email follow the commit, as for invoices.
 *
 * Customer credit lives in `credits/{customerId}`, written only in the transactions that
 * make or use it (here, and recording or undoing a payment).
 */
import {
  type CalendarDate, type CreditNoteInput, type CreditNoteTitle, type InvoiceDocument, type InvoiceSnapshot, type Line, type Toea,
  afterCreditNote, balanceOf, creditNoteProblems, creditNoteTitle, documentNumber, formatKina, hasFeature, localDate, nextNumberOf, toea,
} from "@sasimem/core";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { type OrgDoc, refs } from "./runs.js";

/** A credit note as stored: orgs/{orgId}/creditNotes/{id}, written only here and by its PDF. */
export interface StoredCreditNote {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly number: string;
  readonly numberSeq: number;
  readonly documentTitle: CreditNoteTitle;
  readonly issueDate: CalendarDate;
  readonly reason: string;
  readonly lines: readonly Line[];
  readonly subtotalToea: Toea;
  readonly gstToea: Toea;
  readonly totalToea: Toea;
  /** Taken off the invoice's balance, and what the invoice still owed after. */
  readonly appliedToea: Toea;
  readonly balanceAfterToea: Toea;
  /** The rest, added to the customer's credit. */
  readonly creditToea: Toea;
  /** The invoice's, as it was frozen: the same business, customer and template. */
  readonly snapshot: InvoiceSnapshot;
  readonly pdfPath: string;
  readonly issuedAt: Timestamp;
  readonly issuedBy: string;
}

export type CreditNoteOutcome =
  | { readonly kind: "issued"; readonly creditNote: StoredCreditNote }
  | { readonly kind: "alreadyIssued"; readonly creditNote: StoredCreditNote }
  | { readonly kind: "notEnabled" }
  | { readonly kind: "refused"; readonly message: string };

export const creditNotesOf = (orgId: string) => refs(orgId).org.collection("creditNotes");
export const creditOf = (orgId: string, customerId: string) => refs(orgId).org.collection("credits").doc(customerId);
export const creditNotePdfPath = (orgId: string, id: string): string => `creditNotes/${orgId}/${id}.pdf`;

/** A customer's credit as read in a transaction; none until they have some. */
export const creditIn = (snap: { readonly exists: boolean; get(field: string): unknown } | undefined): Toea => {
  const v = snap?.exists === true ? snap.get("balanceToea") : 0;
  return toea(typeof v === "number" && Number.isSafeInteger(v) ? v : 0);
};

/** Add to (or, negative, take from) a customer's credit, already read in this transaction. */
export function changeCredit(tx: Transaction, ref: DocumentReference, was: Toea, by: number, customerName: string, at: Timestamp): void {
  if (by === 0) return;
  tx.set(ref, { balanceToea: was + by, customerName, updatedAt: at });
}

export async function issueCreditNote(orgId: string, creditNoteId: string, input: CreditNoteInput, req: { readonly actor: string; readonly now: Date }): Promise<CreditNoteOutcome> {
  const r = refs(orgId);
  const ref = creditNotesOf(orgId).doc(creditNoteId);
  return db().runTransaction(async (tx): Promise<CreditNoteOutcome> => {
    const existing = await tx.get(ref);
    if (existing.exists) return { kind: "alreadyIssued", creditNote: existing.data() as StoredCreditNote };

    const [orgSnap, counterSnap, invoiceSnap] = await tx.getAll(r.org, r.counter, r.invoice(input.invoiceId));
    const org = orgSnap?.data() as OrgDoc & { readonly modules?: unknown; readonly features?: unknown };
    if (!hasFeature(org, "oneOff")) return { kind: "notEnabled" };
    if (invoiceSnap?.exists !== true) return { kind: "refused", message: "That invoice is not there any more. Reload and try again." };
    const invoice = invoiceSnap.data() as InvoiceDocument;
    const problem = Object.values(creditNoteProblems(input, invoice))[0];
    if (problem !== undefined || invoice.snapshot === null || invoice.number === null) return { kind: "refused", message: problem ?? "Only a sent or paid invoice can be credited." };

    const creditRef = creditOf(orgId, invoice.tenantId);
    const credit = creditIn(await tx.get(creditRef));
    const after = afterCreditNote(invoice, input);
    const seq = nextNumberOf(counterSnap?.data() ?? {}, "creditNote");
    const number = documentNumber("creditNote", seq, org);
    const at = Timestamp.fromDate(req.now);
    const customerName = invoice.snapshot.tenantName;

    tx.update(invoiceSnap.ref, {
      ...after.invoice,
      ...(after.invoice.status === "paid" && invoice.status !== "paid" ? { paidAt: at, paidNote: `Credit note ${number}` } : {}),
    });
    const creditNote: StoredCreditNote = {
      invoiceId: input.invoiceId, invoiceNumber: invoice.number, customerId: invoice.tenantId, customerName,
      number, numberSeq: seq, documentTitle: creditNoteTitle(invoice), issueDate: localDate(req.now, org.timezone), reason: input.reason.trim(),
      lines: after.lines, ...after.totals, appliedToea: after.appliedToea, creditToea: after.creditToea,
      balanceAfterToea: balanceOf({ ...invoice, ...after.invoice }),
      snapshot: invoice.snapshot, pdfPath: "", issuedAt: at, issuedBy: req.actor,
    };
    tx.create(ref, creditNote);
    changeCredit(tx, creditRef, credit, after.creditToea, customerName, at);
    tx.set(r.counter, { nextCreditNoteNumber: seq + 1 }, { merge: true });
    tx.create(r.events.doc(), {
      actor: req.actor, kind: "creditNoteIssued", at, target: `creditNotes/${creditNoteId}`,
      note: `${number} for ${invoice.number}, ${formatKina(after.totals.totalToea)}: ${creditNote.reason}`,
    });
    return { kind: "issued", creditNote };
  });
}

export async function storedCreditNote(orgId: string, id: string): Promise<StoredCreditNote | null> {
  const snap = await creditNotesOf(orgId).doc(id).get();
  return snap.exists ? (snap.data() as StoredCreditNote) : null;
}
