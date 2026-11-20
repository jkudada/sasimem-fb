/**
 * Sending a quote (docs/PLAN-GENERAL-INVOICING.md §3.3; test list general-g2q.md G2q-a).
 * One transaction reads the draft, re-checks it with core, takes the next `QUO-` number
 * from its own counter, freezes the snapshot and terms (I5), records the link's hash
 * (I10) and writes the quote as sent; the draft goes. The PDF and the email follow the
 * commit, as for an invoice: a crash can lose the email, never send it twice.
 */
import {
  type CalendarDate, type InvoiceDocument, type InvoiceSnapshot, type InvoiceTemplate, type IssuedQuote, type Period, type QuoteStatus,
  addDays, customerOf, documentNumber, hasFeature, issuedQuote, localDate, nextNumberOf, oneOffSnapshot, quoteDraftOf, quoteLabel, quoteProblems,
  templateFor, zonedInstant,
} from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { bucket, db } from "../admin.js";
import { tokenId } from "../links.js";
import { renderInvoicePdf } from "../pdf.js";
import { type OrgDoc, refs } from "./runs.js";

/** How long after its valid-until day a quote's link still opens (to say it has expired). */
export const QUOTE_LINK_DAYS_AFTER = 60;

/** A quote as stored at orgs/{orgId}/quotes/{id}. Server-written only (I9). */
export interface StoredQuote extends IssuedQuote {
  readonly customerName: string;
  readonly number: string;
  readonly numberSeq: number;
  readonly revision: number;
  readonly status: QuoteStatus;
  readonly snapshot: InvoiceSnapshot;
  readonly pdfPath: string;
  /** SHA-256 of the current revision's link. */
  readonly tokenId: string;
  readonly sentAt: Timestamp;
  readonly sentBy: string;
}

export const quotesOf = (orgId: string) => refs(orgId).org.collection("quotes");
export const quoteTokenDoc = (id: string) => db().doc(`quoteTokens/${id}`);
export const quotePdfPath = (orgId: string, id: string, revision: number) => `quotes/${orgId}/${id}-r${revision}.pdf`;

export type SendQuoteOutcome =
  | { readonly kind: "sent"; readonly quote: StoredQuote }
  | { readonly kind: "alreadySent"; readonly quote: StoredQuote }
  | { readonly kind: "notFound" }
  | { readonly kind: "notEnabled" }
  | { readonly kind: "refused"; readonly message: string };

type QuoteOrg = OrgDoc & { readonly quoteValidDays?: number; readonly quoteTerms?: string; readonly modules?: unknown; readonly features?: unknown };

/** Quotes need one-off invoicing too: an accepted quote becomes a one-off invoice. */
export const quotesOn = (org: QuoteOrg): boolean => hasFeature(org, "quotes") && hasFeature(org, "oneOff");

/** `token` is the link's secret, made by the caller; only its hash is stored. */
export async function sendQuote(orgId: string, draftId: string, req: { readonly actor: string; readonly now: Date; readonly token: string }): Promise<SendQuoteOutcome> {
  const r = refs(orgId);
  const draftRef = r.org.collection("quoteDrafts").doc(draftId);
  const quoteRef = quotesOf(orgId).doc(draftId);
  return db().runTransaction(async (tx): Promise<SendQuoteOutcome> => {
    const existing = await tx.get(quoteRef);
    if (existing.exists) return { kind: "alreadySent", quote: existing.data() as StoredQuote };
    const draftSnap = await tx.get(draftRef);
    if (!draftSnap.exists) return { kind: "notFound" };

    const [orgSnap, counterSnap, templateSnap] = await Promise.all([tx.get(r.org), tx.get(r.counter), tx.get(r.templates)]);
    const org = orgSnap.data() as QuoteOrg;
    if (!quotesOn(org)) return { kind: "notEnabled" };

    const draft = quoteDraftOf(draftSnap.data() ?? {});
    const customerSnap = draft.customerId === "" ? null : await tx.get(r.tenant(draft.customerId));
    const customer = customerSnap?.exists === true ? customerOf(customerSnap.data() ?? {}) : null;
    const problem = Object.values(quoteProblems(draft, customer))[0];
    if (problem !== undefined || customer === null) return { kind: "refused", message: problem ?? "Choose who this quote is for." };

    const seq = nextNumberOf(counterSnap.data() ?? {}, "quote");
    const number = documentNumber("quote", seq, org);
    const issued = issuedQuote({ draft, org, today: localDate(req.now, org.timezone) });
    const templates = Object.fromEntries(templateSnap.docs.map((d) => [d.id, d.data() as InvoiceTemplate]));
    const at = Timestamp.fromDate(req.now);
    const id = tokenId(req.token);

    const quote: StoredQuote = {
      ...issued, customerName: customer.name, number, numberSeq: seq, revision: 1, status: "sent",
      snapshot: oneOffSnapshot(org, customer, { poNumber: "", notes: draft.notes }, templateFor({ org }, templates)),
      pdfPath: "", tokenId: id, sentAt: at, sentBy: req.actor,
    };
    tx.create(quoteRef, quote);
    tx.create(quoteTokenDoc(id), {
      orgId, quoteId: draftId, revision: 1,
      expiresAt: Timestamp.fromDate(zonedInstant(addDays(issued.validUntil, QUOTE_LINK_DAYS_AFTER + 1), 0, org.timezone)),
    });
    tx.set(r.counter, { nextQuoteNumber: seq + 1 }, { merge: true });
    tx.delete(draftRef);
    tx.create(r.events.doc(), { actor: req.actor, kind: "quoteSent", at, target: `quotes/${draftId}`, note: `${number}, ${customer.name}` });
    return { kind: "sent", quote };
  });
}

/** A quote as the invoice layouts print it: "QUOTATION", its number, date and lines on the frozen look. */
function printable(q: StoredQuote): InvoiceDocument {
  return {
    tenancyId: "", period: q.issueDate.slice(0, 7) as Period, issueDate: q.issueDate, dueDate: q.validUntil, paymentReference: "",
    lines: q.lines, subtotalToea: q.subtotalToea, gstToea: q.gstToea, totalToea: q.totalToea,
    documentTitle: "QUOTATION" as unknown as InvoiceDocument["documentTitle"],
    tenantId: q.customerId, tenantName: q.customerName, unitLabel: "", status: "sent", numberSeq: q.numberSeq,
    number: quoteLabel(q.number, q.revision),
    snapshot: q.snapshot, pdfPath: "", sentAt: null, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
  };
}

export const renderQuotePdf = (q: StoredQuote, logo: Buffer | null, opts: { compress?: boolean } = {}): Promise<Buffer> =>
  renderInvoicePdf(printable(q), logo, { ...opts, quote: { validUntil: q.validUntil as CalendarDate, terms: q.terms } });

const alreadyExists = (e: unknown) => (e as { code?: unknown }).code === 412;

/** The quote's PDF, once per revision, stored as an invoice's is. Returns the quote with its path. */
export async function quotePdfOf(orgId: string, id: string): Promise<StoredQuote> {
  const ref = quotesOf(orgId).doc(id);
  const q = (await ref.get()).data() as StoredQuote;
  if (q.pdfPath !== "") return q;
  const path = quotePdfPath(orgId, id, q.revision);
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    const logoPath = q.snapshot.org.logoPath;
    const logo = logoPath === null ? null : await bucket().file(logoPath).download().then(([b]) => b, () => null);
    const pdf = await renderQuotePdf(q, logo);
    try {
      await file.save(pdf, { contentType: "application/pdf", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (e) {
      if (!alreadyExists(e)) throw e;
    }
  }
  await ref.update({ pdfPath: path });
  return { ...q, pdfPath: path };
}
