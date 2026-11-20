/**
 * Sending a quote (docs/PLAN-GENERAL-INVOICING.md §3.3; test list general-g2q.md G2q-a).
 * One transaction reads the draft, re-checks it with core, takes the next `QUO-` number
 * from its own counter, freezes the snapshot and terms (I5), records the link's hash
 * (I10) and writes the quote as sent; the draft goes. The PDF and the email follow the
 * commit, as for an invoice: a crash can lose the email, never send it twice.
 */
import {
  type AcceptedQuote, type CalendarDate, type InvoiceDocument, type InvoiceSnapshot, type InvoiceTemplate, type IssuedQuote, type OneOffDraft, type Period,
  type QuoteAnswer, type QuoteInvoiceKind, type QuoteSettings, type QuoteStatus,
  addDays, customerOf, depositApplies, documentNumber, finalDraftFromQuote, followUpAtOf, followUpDue, hasFeature, invoiceDraftFromQuote, issuedQuote,
  localDate, nextNumberOf, noAnswerReason, oneOffSnapshot, quoteAllows, quoteDraftOf, quoteExpired, quoteFromDraftId, quoteInvoiceId, quoteInvoiced,
  quoteLabel, quoteProblems, templateFor, zonedInstant,
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
  /** What those invoices came to (G2q-c). */
  readonly invoicedToea?: number;
  /** When the one follow-up goes (G2q-c); null when the org had it off at sending. */
  readonly followUpAt?: Timestamp | null;
  readonly followedUpAt?: Timestamp;
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
  /** `quoteId` is the draft's id for a new quote, the revised quote's for a revision. */
  | { readonly kind: "sent"; readonly quote: StoredQuote; readonly quoteId: string }
  | { readonly kind: "alreadySent"; readonly quote: StoredQuote }
  | { readonly kind: "notFound" }
  | { readonly kind: "notEnabled" }
  | { readonly kind: "refused"; readonly message: string };

type QuoteOrg = OrgDoc & QuoteSettings & { readonly modules?: unknown; readonly features?: unknown };

/** A link works until 60 days after its valid-until day ends, in the org's time. */
const linkExpiry = (validUntil: CalendarDate, timezone: string): Timestamp =>
  Timestamp.fromDate(zonedInstant(addDays(validUntil, QUOTE_LINK_DAYS_AFTER + 1), 0, timezone));

const followUpOf = (sentAt: Date, org: QuoteOrg): Timestamp | null => {
  const at = followUpAtOf(sentAt, org);
  return at === null ? null : Timestamp.fromDate(at);
};

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
    const revisedRef = draft.revises === null ? null : quotesOf(orgId).doc(draft.revises);
    const [customerSnap, revisedSnap] = await Promise.all([
      draft.customerId === "" ? null : tx.get(r.tenant(draft.customerId)),
      revisedRef === null ? null : tx.get(revisedRef),
    ]);
    const customer = customerSnap?.exists === true ? customerOf(customerSnap.data() ?? {}) : null;
    const problem = Object.values(quoteProblems(draft, customer))[0];
    if (problem !== undefined || customer === null) return { kind: "refused", message: problem ?? "Choose who this quote is for." };
    const templates = Object.fromEntries(templateSnap.docs.map((d) => [d.id, d.data() as InvoiceTemplate]));
    const at = Timestamp.fromDate(req.now);
    const id = tokenId(req.token);
    const issued = issuedQuote({ draft, org, today: localDate(req.now, org.timezone) });
    const snapshot = oneOffSnapshot(org, customer, { poNumber: "", notes: draft.notes }, templateFor({ org }, templates));

    if (revisedRef !== null) {
      // G2q-c: the next revision of the same quote. The one before is kept as it was; its link stops accepting.
      const before = revisedSnap?.data() as StoredQuote | undefined;
      if (before === undefined) return { kind: "refused", message: "The quote this revises is not there any more." };
      const was = quoteLabel(before.number, before.revision);
      if (!quoteAllows(before, req.now, org.timezone).revise) {
        return { kind: "refused", message: before.status === "accepted" ? `${was} was accepted, so it cannot be revised. Undo the acceptance first.` : `${was} has been invoiced, so it cannot be revised.` };
      }
      const revision = before.revision + 1;
      const quote: StoredQuote = {
        ...issued, customerName: customer.name, number: before.number, numberSeq: before.numberSeq, revision, status: "sent",
        snapshot, pdfPath: "", tokenId: id, sentAt: at, sentBy: req.actor, followUpAt: followUpOf(req.now, org),
      };
      tx.set(revisedRef.collection("revisions").doc(String(before.revision)), { ...before, supersededAt: at });
      tx.set(revisedRef, quote); // a fresh start: no view, answer, expiry or follow-up carried over
      tx.create(quoteTokenDoc(id), { orgId, quoteId: revisedRef.id, revision, expiresAt: linkExpiry(issued.validUntil, org.timezone) });
      tx.delete(draftRef);
      tx.create(r.events.doc(), { actor: req.actor, kind: "quoteRevised", at, target: `quotes/${revisedRef.id}`, note: `${quoteLabel(before.number, revision)}, ${customer.name}` });
      return { kind: "sent", quote, quoteId: revisedRef.id };
    }

    const seq = nextNumberOf(counterSnap.data() ?? {}, "quote");
    const number = documentNumber("quote", seq, org);
    const quote: StoredQuote = {
      ...issued, customerName: customer.name, number, numberSeq: seq, revision: 1, status: "sent",
      snapshot, pdfPath: "", tokenId: id, sentAt: at, sentBy: req.actor, followUpAt: followUpOf(req.now, org),
    };
    tx.create(quoteRef, quote);
    tx.create(quoteTokenDoc(id), { orgId, quoteId: draftId, revision: 1, expiresAt: linkExpiry(issued.validUntil, org.timezone) });
    tx.set(r.counter, { nextQuoteNumber: seq + 1 }, { merge: true });
    tx.delete(draftRef);
    tx.create(r.events.doc(), { actor: req.actor, kind: "quoteSent", at, target: `quotes/${draftId}`, note: `${number}, ${customer.name}` });
    return { kind: "sent", quote, quoteId: draftId };
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

const draftRefOf = (orgId: string, id: string) => refs(orgId).org.collection("drafts").doc(id);
const scheduleRefOf = (orgId: string, id: string) => refs(orgId).org.collection("sendLater").doc(id);

/** An accepted quote as core converts it. */
const acceptedOf = (q: StoredQuote, acceptance: QuoteAcceptance, timezone: string): AcceptedQuote => ({
  customerId: q.customerId, lines: q.lines, number: q.number, revision: q.revision, notes: q.snapshot.notes ?? "",
  acceptance: { name: acceptance.name, poNumber: acceptance.poNumber, acceptedOn: localDate(acceptance.at.toDate(), timezone) },
});

/** A draft as the rules let the owner keep editing it: exactly its five fields, lines as plain maps. */
const draftDoc = (d: OneOffDraft) => ({ customerId: d.customerId, lines: d.lines.map((l) => ({ ...l })), poNumber: d.poNumber, notes: d.notes, dueDays: d.dueDays });

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
  /** `draftId`: the invoice draft an acceptance made (D14), if it made one. */
  | { readonly kind: "recorded"; readonly quote: StoredQuote; readonly draftId?: string }
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
    const [snap, orgSnap] = await Promise.all([tx.get(ref), tx.get(r.org)]);
    const org = orgSnap.data() as QuoteOrg;
    const timezone = org.timezone ?? "Pacific/Port_Moresby";
    if (!snap.exists) return { kind: "notFound" };
    const q = snap.data() as StoredQuote;
    if (req.revision !== undefined && req.revision !== q.revision) return { kind: "superseded", revision: q.revision };
    const ids = { full: quoteInvoiceId(quoteId, q.revision, "full"), deposit: quoteInvoiceId(quoteId, q.revision, "deposit") };
    const drafted = answer.kind === "accept"
      ? (await Promise.all([tx.get(draftRefOf(orgId, ids.full)), tx.get(draftRefOf(orgId, ids.deposit))])).some((d) => d.exists)
      : true;
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
    if (update.acceptance !== undefined && !drafted) {
      // D14: the invoice is drafted at once, in full or as a deposit (D13), and waits for the owner's Send.
      const kind = depositApplies(org, q.totalToea) ? "deposit" : "full";
      tx.create(draftRefOf(orgId, ids[kind]), draftDoc(invoiceDraftFromQuote(acceptedOf(q, update.acceptance, timezone), kind, org)));
      return { kind: "recorded", quote: { ...q, ...update }, draftId: ids[kind] };
    }
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
      return { kind: "refused", message: q.status === "accepted" || q.status === "invoiced" ? `${label} has been invoiced, so its acceptance stays.` : `${label} is not accepted.` };
    }
    tx.update(ref, { status: "sent", acceptance: FieldValue.delete() });
    // Its invoice draft goes too: nothing was sent from it (undo is refused once anything is).
    for (const kind of ["full", "deposit"] as const) {
      const id = quoteInvoiceId(quoteId, q.revision, kind);
      tx.delete(draftRefOf(orgId, id));
      tx.delete(scheduleRefOf(orgId, id));
    }
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

// ---------------------------------------------------------------- converting to an invoice (G2q-c)

export type DraftFromQuoteOutcome =
  | { readonly kind: "drafted"; readonly draftId: string; readonly label: string }
  | { readonly kind: "notFound" }
  | { readonly kind: "refused"; readonly message: string };

/**
 * The owner's choice of invoice for an accepted quote: in full or a deposit (switching the
 * unsent draft), or the final invoice once the deposit invoice is sent. Each kind is made
 * once per revision (the draft and its invoice share the id).
 */
export async function draftFromQuote(orgId: string, quoteId: string, kind: QuoteInvoiceKind, _req: { readonly actor: string; readonly now: Date }): Promise<DraftFromQuoteOutcome> {
  const r = refs(orgId);
  const ref = quotesOf(orgId).doc(quoteId);
  return db().runTransaction(async (tx): Promise<DraftFromQuoteOutcome> => {
    const [snap, orgSnap] = await Promise.all([tx.get(ref), tx.get(r.org)]);
    if (!snap.exists) return { kind: "notFound" };
    const q = snap.data() as StoredQuote;
    const org = orgSnap.data() as QuoteOrg;
    const label = quoteLabel(q.number, q.revision);
    const acceptance = q.acceptance;
    if (acceptance === undefined || (q.status !== "accepted" && q.status !== "invoiced")) return { kind: "refused", message: `${label} is not accepted.` };
    const id = (k: QuoteInvoiceKind) => quoteInvoiceId(quoteId, q.revision, k);
    const [wanted, wantedInvoice] = await Promise.all([tx.get(draftRefOf(orgId, id(kind))), tx.get(r.invoice(id(kind)))]);
    const accepted = acceptedOf(q, acceptance, org.timezone);

    if (kind === "final") {
      const deposit = await tx.get(r.invoice(id("deposit")));
      if (!deposit.exists) return { kind: "refused", message: `Send the deposit invoice for ${label} first.` };
      if (wantedInvoice.exists) return { kind: "refused", message: `The final invoice for ${label} was already sent.` };
      if (!wanted.exists) {
        const d = deposit.data() as InvoiceDocument;
        tx.create(draftRefOf(orgId, id("final")), draftDoc(finalDraftFromQuote(accepted, { number: d.number ?? "the deposit", lines: d.lines })));
      }
      return { kind: "drafted", draftId: id("final"), label };
    }

    if ((q.invoiceIds ?? []).length > 0) return { kind: "refused", message: `Part of ${label} is already invoiced, so its draft stays as it is.` };
    const other = kind === "full" ? id("deposit") : id("full");
    tx.delete(draftRefOf(orgId, other));
    tx.delete(scheduleRefOf(orgId, other));
    if (!wanted.exists) tx.create(draftRefOf(orgId, id(kind)), draftDoc(invoiceDraftFromQuote(accepted, kind, org)));
    return { kind: "drafted", draftId: id(kind), label };
  });
}

/**
 * Inside issueOneOff's transaction: an invoice sent from a quote's draft counts against the
 * quote (quoted vs invoiced). Read first (`read`), write after (`write`), as a transaction
 * needs. Nothing for an invoice that was not made from a quote, or a quote no longer accepted.
 */
export async function quoteInvoicing(tx: FirebaseFirestore.Transaction, orgId: string, invoiceId: string) {
  const from = quoteFromDraftId(invoiceId);
  const ref = from === null ? null : quotesOf(orgId).doc(from.quoteId);
  const q = ref === null ? undefined : ((await tx.get(ref)).data() as StoredQuote | undefined);
  const counts = from !== null && q?.acceptance !== undefined && q.acceptance.revision === from.revision && (q.status === "accepted" || q.status === "invoiced");
  return {
    label: q === undefined ? null : quoteLabel(q.number, q.revision),
    write(totalToea: number): void {
      if (!counts || ref === null || q === undefined) return;
      const invoicedToea = (q.invoicedToea ?? 0) + totalToea;
      tx.update(ref, {
        invoiceIds: FieldValue.arrayUnion(invoiceId), invoicedToea,
        status: quoteInvoiced({ acceptance: q.acceptance, invoicedToea }).invoiced ? "invoiced" : "accepted",
      });
    },
  };
}

// ---------------------------------------------------------------- the follow-up (G2q-c)

/** Open quotes whose follow-up time has come (the collection-group index on status and followUpAt). */
export async function quotesToFollowUp(now: Date, orgIds?: readonly string[]): Promise<QuoteRef[]> {
  const snap = await db().collectionGroup("quotes").where("status", "in", ["sent", "viewed"]).where("followUpAt", "<=", Timestamp.fromDate(now)).get();
  const all = snap.docs.map((d) => ({ orgId: d.ref.parent.parent?.id ?? "", quoteId: d.id }));
  return orgIds === undefined ? all : all.filter((q) => orgIds.includes(q.orgId));
}

/**
 * Claim a quote's one follow-up: mark it followed up and record a fresh link to the same
 * revision (only the link's hash is kept, I10, so the first link cannot be sent again).
 * The quote for the call that claimed it, null otherwise. A crash can lose the email, never send it twice.
 */
export async function claimFollowUp(q: QuoteRef, now: Date, token: string): Promise<StoredQuote | null> {
  const r = refs(q.orgId);
  const ref = quotesOf(q.orgId).doc(q.quoteId);
  return db().runTransaction(async (tx) => {
    const [snap, orgSnap] = await Promise.all([tx.get(ref), tx.get(r.org)]);
    const quote = snap.data() as StoredQuote | undefined;
    const org = orgSnap.data() as QuoteOrg | undefined;
    if (quote === undefined || org === undefined) return null;
    const due = followUpDue(
      { status: quote.status, validUntil: quote.validUntil, followUpAt: quote.followUpAt?.toDate() ?? null, followedUp: quote.followedUpAt !== undefined },
      org, now, org.timezone,
    );
    if (!due) return null;
    const at = Timestamp.fromDate(now);
    tx.update(ref, { followedUpAt: at });
    tx.create(quoteTokenDoc(tokenId(token)), { orgId: q.orgId, quoteId: q.quoteId, revision: quote.revision, expiresAt: linkExpiry(quote.validUntil, org.timezone) });
    tx.create(r.events.doc(), { actor: "tick", kind: "quoteFollowedUp", at, target: `quotes/${q.quoteId}`, note: `${quoteLabel(quote.number, quote.revision)}, ${quote.customerName}` });
    return { ...quote, followedUpAt: at };
  });
}
