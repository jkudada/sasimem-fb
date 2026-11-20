/**
 * Issuing a one-off invoice (docs/PLAN-GENERAL-INVOICING.md G2a). One transaction reads
 * the draft, re-checks it with core, takes the next number from the shared counter (I3),
 * freezes the snapshot (I5) and writes the invoice as sent; the draft goes. The PDF and
 * the email follow the commit, as for a run: a crash can lose the email (the log shows
 * it missing, and Resend sends it), never send it twice.
 *
 * A one-off is written straight to `sent`, never draft, excluded or approved, so the rent
 * paths that load "every invoice in month X" (approval, rebuild, PDFs, release) skip it.
 *
 * A draft scheduled to send later (G2d) goes through here too: issuing drops its schedule,
 * and the tick's call (`scheduled`) issues only while the schedule stands and is due.
 */
import {
  type InvoiceDocument, type InvoiceTemplate, customerOf, documentNumber, draftOf, draftProblems, hasFeature, issuedOneOff,
  localDate, nextNumberOf, numbered, oneOffSnapshot, sendLaterDue, templateFor,
} from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { quoteInvoicing } from "./quotes.js";
import { type OrgDoc, refs } from "./runs.js";
import { sendLaterRef } from "./sendLater.js";

export type IssueOutcome =
  | { readonly kind: "issued"; readonly number: string; readonly customerName: string }
  | { readonly kind: "alreadyIssued"; readonly number: string }
  | { readonly kind: "notFound" }
  /** The tick's call only: the schedule was cancelled, moved or already found wanting. */
  | { readonly kind: "notDue" }
  | { readonly kind: "notEnabled" }
  | { readonly kind: "refused"; readonly message: string };

export async function issueOneOff(orgId: string, draftId: string, req: { readonly actor: string; readonly now: Date; readonly scheduled?: boolean }): Promise<IssueOutcome> {
  const r = refs(orgId);
  const draftRef = r.org.collection("drafts").doc(draftId);
  return db().runTransaction(async (tx): Promise<IssueOutcome> => {
    const existing = await tx.get(r.invoice(draftId));
    if (existing.exists) return { kind: "alreadyIssued", number: existing.get("number") as string };
    const [draftSnap, scheduleSnap] = await Promise.all([tx.get(draftRef), tx.get(sendLaterRef(orgId, draftId))]);
    if (req.scheduled === true) {
      const sendAt = scheduleSnap.get("sendAt") as Timestamp | undefined;
      if (sendAt === undefined || !sendLaterDue({ sendAt: sendAt.toDate() }, req.now)) return { kind: "notDue" };
    }
    if (!draftSnap.exists) return { kind: "notFound" };

    const [orgSnap, counterSnap, templateSnap] = await Promise.all([tx.get(r.org), tx.get(r.counter), tx.get(r.templates)]);
    const org = orgSnap.data() as OrgDoc & { readonly defaultTermsDays?: number; readonly modules?: unknown; readonly features?: unknown };
    if (!hasFeature(org, "oneOff")) return { kind: "notEnabled" };

    const draft = draftOf(draftSnap.data() ?? {});
    const customerSnap = draft.customerId === "" ? null : await tx.get(r.tenant(draft.customerId));
    const customer = customerSnap?.exists === true ? customerOf(customerSnap.data() ?? {}) : null;
    const problem = Object.values(draftProblems(draft, customer))[0];
    if (problem !== undefined || customer === null) return { kind: "refused", message: problem ?? "Choose who this invoice is for." };

    const fromQuote = await quoteInvoicing(tx, orgId, draftId); // G2q-c: read now, written below
    const seq = nextNumberOf(counterSnap.data() ?? {}, "invoice");
    const number = documentNumber("invoice", seq, org);
    const issued = numbered(issuedOneOff({ draftId, draft, customer, org, today: localDate(req.now, org.timezone) }), number);
    const templates = Object.fromEntries(templateSnap.docs.map((d) => [d.id, d.data() as InvoiceTemplate]));
    const at = Timestamp.fromDate(req.now);

    const invoice: Omit<InvoiceDocument, "sentAt"> & { sentAt: Timestamp } = {
      ...issued,
      tenantId: draft.customerId, tenantName: customer.name, unitLabel: "",
      status: "sent", numberSeq: seq, number,
      snapshot: oneOffSnapshot(org, customer, draft, templateFor({ org }, templates)),
      pdfPath: "", sentAt: at, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
    };
    tx.create(r.invoice(draftId), invoice);
    fromQuote.write(invoice.totalToea);
    tx.create(r.issued(seq), { invoiceId: draftId, at });
    tx.set(r.counter, { nextInvoiceNumber: seq + 1 }, { merge: true });
    tx.delete(draftRef);
    if (scheduleSnap.exists) tx.delete(scheduleSnap.ref);
    tx.create(r.events.doc(), { actor: req.actor, kind: "invoiceIssued", at, target: `invoices/${draftId}`, note: `${number}, ${customer.name}${fromQuote.label === null ? "" : `, from ${fromQuote.label}`}${req.scheduled === true ? ", as scheduled" : ""}` });
    return { kind: "issued", number, customerName: customer.name };
  });
}
