/**
 * Quotes (docs/PLAN-GENERAL-INVOICING.md §3.3, D11-D18; test list general-g2q.md). The
 * owner writes a draft; sending numbers it (`QUO-`), freezes it and emails it. Pure;
 * Functions number, freeze, render and send. A quote is not a tax document.
 */
import { totals } from "./billing.js";
import type { Customer } from "./customers.js";
import { itemLine } from "./lines.js";
import { lineOf, linesProblem } from "./oneoff.js";
import { addDays, type CalendarDate, dateLabel, localDate } from "./period.js";
import { wholeIn } from "./setup.js";
import type { ItemLineInput, Line, Problems, Totals } from "./types.js";

// ---------------------------------------------------------------- the draft

/** What the owner is writing: orgs/{orgId}/quoteDrafts/{id}. */
export interface QuoteDraft {
  readonly customerId: string;
  readonly lines: readonly ItemLineInput[];
  readonly notes: string;
  /** Days the quote is valid; null means the org's, else 30. */
  readonly validDays: number | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A stored quote draft, read defensively, as draftOf reads an invoice draft. */
export function quoteDraftOf(doc: Readonly<Record<string, unknown>>): QuoteDraft {
  return {
    customerId: text(doc.customerId),
    lines: (Array.isArray(doc.lines) ? (doc.lines as unknown[]) : []).map(lineOf),
    notes: text(doc.notes),
    validDays: typeof doc.validDays === "number" ? doc.validDays : null,
  };
}

export const DEFAULT_QUOTE_VALID_DAYS = 30;
export const MAX_QUOTE_VALID_DAYS = 365;

const validDaysProblem = (days: number): string | null =>
  wholeIn(days, 1, MAX_QUOTE_VALID_DAYS) ? null : `Choose from 1 to ${MAX_QUOTE_VALID_DAYS} days.`;

/** What stops a quote draft being sent. `customer` is the record the draft names, or null if it is missing. */
export function quoteProblems(draft: QuoteDraft, customer: Customer | null): Problems<keyof QuoteDraft> {
  const p: Problems<keyof QuoteDraft> = {};
  if (draft.customerId === "" || customer === null) p.customerId = "Choose who this quote is for.";
  const lines = linesProblem(draft.lines, "quote");
  if (lines !== null) p.lines = lines;
  if (draft.notes.length > 500) p.notes = "Keep the notes to 500 characters or fewer.";
  const days = draft.validDays === null ? null : validDaysProblem(draft.validDays);
  if (days !== null) p.validDays = days;
  return p;
}

/** The last day it can be accepted: the send day plus the quote's own days, else the org's, else 30. */
export const validUntilOf = (sentOn: CalendarDate, days: { quote: number | null; org: number | undefined }): CalendarDate =>
  addDays(sentOn, days.quote ?? days.org ?? DEFAULT_QUOTE_VALID_DAYS);

// ---------------------------------------------------------------- the org's quote settings

export const QUOTE_TERMS_MAX = 2000;

/** N11: Claude's first version, to be checked by an accountant or lawyer. The owner edits it in Settings. */
export const DEFAULT_QUOTE_TERMS = [
  "1. Prices are in kina. Where GST applies it is shown on each line and in the total.",
  "2. This quote is valid until the date shown. After that the prices may change.",
  "3. Work starts once you accept this quote. Accept it with the link in our email, or tell us.",
  "4. We invoice when the work is done, unless a deposit is shown. A deposit is paid before work starts and comes off the final invoice.",
  "5. Payment is due by the date on the invoice, by bank transfer to the account shown on it.",
  "6. Anything not listed in this quote is extra. We will quote it before doing it.",
  "7. If you change or cancel the work after accepting, you pay for work already done and materials already bought for it.",
].join("\n");

export interface QuoteSettings {
  /** 1-365; absent means 30. */
  readonly quoteValidDays?: number;
  /** Printed on every quote; absent means DEFAULT_QUOTE_TERMS, "" means none. */
  readonly quoteTerms?: string;
}

/** The terms a quote prints: the org's own, the default when never set, none when cleared. */
export const quoteTermsOf = (org: QuoteSettings): string => (org.quoteTerms ?? DEFAULT_QUOTE_TERMS).trim();

export function quoteSettingsProblems(s: Required<QuoteSettings>): Problems<keyof QuoteSettings> {
  const p: Problems<keyof QuoteSettings> = {};
  const days = validDaysProblem(s.quoteValidDays);
  if (days !== null) p.quoteValidDays = days;
  if (s.quoteTerms.length > QUOTE_TERMS_MAX) p.quoteTerms = `Keep the terms to ${QUOTE_TERMS_MAX.toLocaleString("en")} characters or fewer.`;
  return p;
}

// ---------------------------------------------------------------- sending

export type QuoteStatus = "sent" | "viewed" | "accepted" | "declined" | "expired";

/** What a quote holds once sent, before its number: dates, priced lines, totals and terms. */
export interface IssuedQuote extends Totals {
  readonly customerId: string;
  readonly issueDate: CalendarDate;
  readonly validUntil: CalendarDate;
  readonly lines: readonly Line[];
  readonly terms: string;
}

/** The quote a draft becomes when sent today (org time). Priced as an invoice would be, GST and all. */
export function issuedQuote(req: {
  draft: QuoteDraft;
  org: QuoteSettings & { readonly gstRegistered: boolean };
  today: CalendarDate;
}): IssuedQuote {
  const lines = req.draft.lines.map((l) => itemLine(l, req.org));
  return {
    customerId: req.draft.customerId,
    issueDate: req.today,
    validUntil: validUntilOf(req.today, { quote: req.draft.validDays, org: req.org.quoteValidDays }),
    lines,
    ...totals(lines),
    terms: quoteTermsOf(req.org),
  };
}

/** "QUO-0012", and "QUO-0012 rev 2" from the second revision on. */
export const quoteLabel = (number: string, revision: number): string => (revision > 1 ? `${number} rev ${revision}` : number);

export const QUOTE_STATUS_LABELS: Readonly<Record<QuoteStatus, string>> = {
  sent: "Sent", viewed: "Viewed", accepted: "Accepted", declined: "Declined", expired: "Expired",
};

// ---------------------------------------------------------------- answering (G2q-b)

/** The customer's answer on the quote's page, or the one the owner records for them. */
export type QuoteAnswer =
  | { readonly kind: "accept"; readonly name: string; readonly poNumber: string }
  | { readonly kind: "decline"; readonly reason: string };

export type QuoteAnswerField = "answer" | "name" | "agree" | "poNumber" | "reason";

export type ReadQuoteAnswer =
  | { readonly ok: true; readonly answer: QuoteAnswer }
  | { readonly ok: false; readonly problems: Problems<QuoteAnswerField> };

/** As on an invoice, where the order number goes next (G2q-c). */
const PO_MAX = 40;

/**
 * Read an answer: `answer` is "accept" or "decline". Accepting needs a name and, from the
 * customer, the "I accept these terms" tick (`agree`); the owner recording a phone call
 * or signed paper needs only the name. Declining takes an optional reason.
 */
export function readQuoteAnswer(form: Readonly<Record<string, string | undefined>>, by: "customer" | "owner"): ReadQuoteAnswer {
  const field = (k: QuoteAnswerField) => (form[k] ?? "").trim();
  const p: Problems<QuoteAnswerField> = {};
  if (form.answer === "decline") {
    const reason = field("reason");
    if (reason.length > 500) return { ok: false, problems: { reason: "Keep the reason to 500 characters or fewer." } };
    return { ok: true, answer: { kind: "decline", reason } };
  }
  if (form.answer !== "accept") return { ok: false, problems: { answer: "Choose to accept or decline." } };
  const name = field("name");
  const poNumber = field("poNumber");
  if (name === "") p.name = by === "customer" ? "Type your name." : "Type the name of the person who accepted.";
  else if (name.length > 100) p.name = "Keep the name to 100 characters or fewer.";
  if (poNumber.length > PO_MAX) p.poNumber = `Keep the order number to ${PO_MAX} characters or fewer.`;
  if (by === "customer" && form.agree === undefined) p.agree = 'Tick "I accept these terms" to accept.';
  return Object.keys(p).length > 0 ? { ok: false, problems: p } : { ok: true, answer: { kind: "accept", name, poNumber } };
}

/** Past its valid-until day, in the org's time. */
export const quoteExpired = (q: { readonly validUntil: CalendarDate }, now: Date, timezone: string): boolean =>
  localDate(now, timezone) > q.validUntil;

export interface QuoteState {
  readonly status: QuoteStatus;
  readonly validUntil: CalendarDate;
  /** The invoices sent from it (G2q-c). */
  readonly invoiceIds?: readonly string[];
}

/**
 * What a quote takes now: an answer while sent or viewed and not past its day; an undone
 * acceptance until anything is invoiced from it. Declined and expired quotes take neither
 * (they can be revised, G2q-c).
 */
export function quoteAllows(q: QuoteState, now: Date, timezone: string): { readonly answer: boolean; readonly undo: boolean } {
  return {
    answer: (q.status === "sent" || q.status === "viewed") && !quoteExpired(q, now, timezone),
    undo: q.status === "accepted" && (q.invoiceIds ?? []).length === 0,
  };
}

/** Why a quote takes no answer, or null when it does. `label` is "QUO-0012" or "QUO-0012 rev 2". */
export function noAnswerReason(q: QuoteState, label: string, now: Date, timezone: string): string | null {
  if (q.status === "accepted") return `${label} was already accepted.`;
  if (q.status === "declined") return `${label} was already declined.`;
  if (q.status === "expired" || quoteExpired(q, now, timezone)) return `${label} expired on ${dateLabel(q.validUntil)}.`;
  return null;
}
