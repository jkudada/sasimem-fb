/**
 * Sending a quote (docs/PLAN-GENERAL-INVOICING.md §3.3; test list general-g2q.md G2q-a).
 * One transaction reads the draft, re-checks it with core, takes the next `QUO-` number
 * from its own counter, freezes the snapshot and terms (I5), records the link's hash
 * (I10) and writes the quote as sent; the draft goes. The PDF and the email follow the
 * commit, as for an invoice: a crash can lose the email, never send it twice.
 */
import {
  type CalendarDate, type InvoiceDocument, type InvoiceSnapshot, type InvoiceTemplate, type IssuedQuote, type Period, type QuoteAnswer, type QuoteStatus,
  addDays, customerOf, documentNumber, hasFeature, issuedQuote, localDate, nextNumberOf, noAnswerReason, oneOffSnapshot, quoteAllows, quoteDraftOf,
  quoteExpired, quoteLabel, quoteProblems, templateFor, zonedInstant,
} from "@sasimem/core";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
  /** The first time the customer opened the link (G2q-b). */
  readonly viewedAt?: Timestamp;
  /** Set while accepted; an undone acceptance removes it (the events keep it). */
  readonly acceptance?: QuoteAcceptance;
  readonly decline?: QuoteDecline;
  readonly expiredAt?: Timestamp;
  /** The invoices sent from it (G2q-c). Once there is one, its acceptance stays. */
  readonly invoiceIds?: readonly string[];
}

/** Who answered: the customer on the link, or the owner recording a call or signed paper. */
export type AnsweredBy = "customer" | "owner";

export interface QuoteAcceptance {
  readonly by: AnsweredBy;
  readonly name: string;
  readonly poNumber: string;
  readonly at: Timestamp;
  /** What was accepted: this revision, at this total. */
  readonly revision: number;
  readonly totalToea: number;
  readonly actor: string;
}

export interface QuoteDecline {
  readonly by: AnsweredBy;
  readonly reason: string;
  readonly at: Timestamp;
  readonly revision: number;
  readonly actor: string;
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

// ---------------------------------------------------------------- the customer's link and answers (G2q-b)

export type QuoteLink =
  | { readonly state: "unknown" }
  /** Past its life (60 days after valid-until): the page says so, and nothing else. */
  | { readonly state: "dead"; readonly orgId: string; readonly quoteId: string }
  | { readonly state: "live"; readonly orgId: string; readonly quoteId: string; readonly revision: number };

export async function lookupQuoteToken(token: string, now: Date): Promise<QuoteLink> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { state: "unknown" };
  const snap = await quoteTokenDoc(tokenId(token)).get();
  if (!snap.exists) return { state: "unknown" };
  const orgId = snap.get("orgId") as string;
  const quoteId = snap.get("quoteId") as string;
  if ((snap.get("expiresAt") as Timestamp).toMillis() <= now.getTime()) return { state: "dead", orgId, quoteId };
  return { state: "live", orgId, quoteId, revision: snap.get("revision") as number };
}

const quoteTimezone = async (tx: FirebaseFirestore.Transaction, orgId: string): Promise<string> =>
  ((await tx.get(refs(orgId).org)).get("timezone") as string | undefined) ?? "Pacific/Port_Moresby";

/** The customer opened it: sent becomes viewed, once, with the time. Nothing else changes. */
export async function markViewed(orgId: string, quoteId: string, revision: number, now: Date): Promise<void> {
  const ref = quotesOf(orgId).doc(quoteId);
  await db().runTransaction(async (tx) => {
    const q = (await tx.get(ref)).data() as StoredQuote | undefined;
    if (q === undefined || q.status !== "sent" || q.revision !== revision || q.viewedAt !== undefined) return;
    tx.update(ref, { status: "viewed", viewedAt: Timestamp.fromDate(now) });
  });
}

export type AnswerOutcome =
  | { readonly kind: "recorded"; readonly quote: StoredQuote }
  | { readonly kind: "notFound" }
  /** The link is for an earlier revision (G2q-c). */
  | { readonly kind: "superseded"; readonly revision: number }
  | { readonly kind: "refused"; readonly message: string };

/**
 * Record an answer, once: a compare-and-set from sent or viewed, inside its valid-until
 * day. `revision` is the link's, for the customer; the owner answers the current one.
 * Only the caller that recorded it emails the owner.
 */
export async function answerQuote(
  orgId: string, quoteId: string, answer: QuoteAnswer,
  req: { readonly by: AnsweredBy; readonly actor: string; readonly now: Date; readonly revision?: number },
): Promise<AnswerOutcome> {
  const r = refs(orgId);
  const ref = quotesOf(orgId).doc(quoteId);
  return db().runTransaction(async (tx): Promise<AnswerOutcome> => {
    const snap = await tx.get(ref);
    const timezone = await quoteTimezone(tx, orgId);
    if (!snap.exists) return { kind: "notFound" };
    const q = snap.data() as StoredQuote;
    if (req.revision !== undefined && req.revision !== q.revision) return { kind: "superseded", revision: q.revision };
    const label = quoteLabel(q.number, q.revision);
    const why = noAnswerReason(q, label, req.now, timezone);
    if (why !== null) return { kind: "refused", message: why };

    const at = Timestamp.fromDate(req.now);
    const base = { by: req.by, at, revision: q.revision, actor: req.actor };
    let update: Partial<StoredQuote>;
    let event: { kind: string; note: string };
    if (answer.kind === "accept") {
      const acceptance: QuoteAcceptance = { ...base, name: answer.name, poNumber: answer.poNumber, totalToea: q.totalToea };
      update = { status: "accepted", acceptance };
      event = { kind: "quoteAccepted", note: `${label}, accepted by ${answer.name}${answer.poNumber === "" ? "" : `, order ${answer.poNumber}`}${req.by === "owner" ? " (recorded by the owner)" : ""}` };
    } else {
      const decline: QuoteDecline = { ...base, reason: answer.reason };
      update = { status: "declined", decline };
      event = { kind: "quoteDeclined", note: `${label}, declined${answer.reason === "" ? "" : `: ${answer.reason}`}${req.by === "owner" ? " (recorded by the owner)" : ""}` };
    }
    tx.update(ref, update);
    tx.create(r.events.doc(), { actor: req.actor, ...event, at, target: `quotes/${quoteId}` });
    return { kind: "recorded", quote: { ...q, ...update } };
  });
}

export type UndoOutcome = { readonly kind: "undone"; readonly quote: StoredQuote } | { readonly kind: "notFound" } | { readonly kind: "refused"; readonly message: string };

/** Back to sent (plan §10: a forwarded link accepted by the wrong person), until anything is invoiced from it. */
export async function undoAcceptance(orgId: string, quoteId: string, req: { readonly actor: string; readonly now: Date }): Promise<UndoOutcome> {
  const r = refs(orgId);
  const ref = quotesOf(orgId).doc(quoteId);
  return db().runTransaction(async (tx): Promise<UndoOutcome> => {
    const snap = await tx.get(ref);
    const timezone = await quoteTimezone(tx, orgId);
    if (!snap.exists) return { kind: "notFound" };
    const q = snap.data() as StoredQuote;
    const label = quoteLabel(q.number, q.revision);
    if (!quoteAllows(q, req.now, timezone).undo) {
      return { kind: "refused", message: q.status === "accepted" ? `${label} has been invoiced, so its acceptance stays.` : `${label} is not accepted.` };
    }
    tx.update(ref, { status: "sent", acceptance: FieldValue.delete() });
    tx.create(r.events.doc(), {
      actor: req.actor, kind: "quoteAcceptanceUndone", at: Timestamp.fromDate(req.now), target: `quotes/${quoteId}`,
      note: `${label}, was accepted by ${q.acceptance?.name ?? "someone"}`,
    });
    const { acceptance: _gone, ...rest } = q;
    return { kind: "undone", quote: { ...rest, status: "sent" } };
  });
}

// ---------------------------------------------------------------- expiry (the tick)

export interface QuoteRef {
  readonly orgId: string;
  readonly quoteId: string;
}

/**
 * Quotes still open whose valid-until day may have ended somewhere (the collection-group
 * index on status and validUntil). No timezone is ahead of UTC by more than a day, so
 * anything that has expired is before tomorrow's UTC date; expireQuote checks the org's.
 */
export async function openQuotesPast(now: Date, orgIds?: readonly string[]): Promise<QuoteRef[]> {
  const tomorrow = addDays(localDate(now, "UTC"), 1);
  const snap = await db().collectionGroup("quotes").where("status", "in", ["sent", "viewed"]).where("validUntil", "<", tomorrow).get();
  const all = snap.docs.map((d) => ({ orgId: d.ref.parent.parent?.id ?? "", quoteId: d.id }));
  return orgIds === undefined ? all : all.filter((q) => orgIds.includes(q.orgId));
}

/** Sent or viewed, and past its day in the org's time: expired, once. True for the call that did it. */
export async function expireQuote(q: QuoteRef, now: Date): Promise<boolean> {
  const r = refs(q.orgId);
  const ref = quotesOf(q.orgId).doc(q.quoteId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const timezone = await quoteTimezone(tx, q.orgId);
    const quote = snap.data() as StoredQuote | undefined;
    if (quote === undefined || (quote.status !== "sent" && quote.status !== "viewed") || !quoteExpired(quote, now, timezone)) return false;
    const at = Timestamp.fromDate(now);
    tx.update(ref, { status: "expired", expiredAt: at });
    tx.create(r.events.doc(), { actor: "tick", kind: "quoteExpired", at, target: `quotes/${q.quoteId}`, note: quoteLabel(quote.number, quote.revision) });
    return true;
  });
}
