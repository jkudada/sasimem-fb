/**
 * Quotes (docs/PLAN-GENERAL-INVOICING.md §3.3, D11-D18; test list general-g2q.md). The
 * owner writes a draft; sending numbers it (`QUO-`), freezes it and emails it. Pure;
 * Functions number, freeze, render and send. A quote is not a tax document.
 */
import { totals } from "./billing.js";
import type { Customer } from "./customers.js";
import { itemLine } from "./lines.js";
import { MAX_EDITABLE_TOEA, type Toea, toea } from "./money.js";
import { type OneOffDraft, lineOf, linesProblem } from "./oneoff.js";
import { addDays, type CalendarDate, dateLabel, localDate } from "./period.js";
import { wholeIn } from "./setup.js";
import type { ItemLineInput, Line, Problems, TaxCode, Totals } from "./types.js";

// ---------------------------------------------------------------- the draft

/** What the owner is writing: orgs/{orgId}/quoteDrafts/{id}. */
export interface QuoteDraft {
  readonly customerId: string;
  readonly lines: readonly ItemLineInput[];
  readonly notes: string;
  /** Days the quote is valid; null means the org's, else 30. */
  readonly validDays: number | null;
  /** The quote this draft revises (G2q-c), or null for a new quote. */
  readonly revises: string | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A stored quote draft, read defensively, as draftOf reads an invoice draft. */
export function quoteDraftOf(doc: Readonly<Record<string, unknown>>): QuoteDraft {
  return {
    customerId: text(doc.customerId),
    lines: (Array.isArray(doc.lines) ? (doc.lines as unknown[]) : []).map(lineOf),
    notes: text(doc.notes),
    validDays: typeof doc.validDays === "number" ? doc.validDays : null,
    revises: typeof doc.revises === "string" && doc.revises !== "" ? doc.revises : null,
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
  /** D13: ask for this share (1-100) as a deposit; absent means no deposits (G2q-c). */
  readonly depositPercent?: number;
  /** D13: only on quotes over this total; absent means over K0.00. */
  readonly depositOverToea?: number;
  /** Remind the customer this many days (1-60) after sending; absent means off (G2q-c). */
  readonly quoteFollowUpDays?: number;
}

/** The terms a quote prints: the org's own, the default when never set, none when cleared. */
export const quoteTermsOf = (org: QuoteSettings): string => (org.quoteTerms ?? DEFAULT_QUOTE_TERMS).trim();

export const MAX_FOLLOW_UP_DAYS = 60;

/** The quote settings as Settings saves them: valid days and terms always, the rest when on. */
export function quoteSettingsProblems(s: Required<Pick<QuoteSettings, "quoteValidDays" | "quoteTerms">> & QuoteSettings): Problems<keyof QuoteSettings> {
  const p: Problems<keyof QuoteSettings> = {};
  const days = validDaysProblem(s.quoteValidDays);
  if (days !== null) p.quoteValidDays = days;
  if (s.quoteTerms.length > QUOTE_TERMS_MAX) p.quoteTerms = `Keep the terms to ${QUOTE_TERMS_MAX.toLocaleString("en")} characters or fewer.`;
  if (s.depositPercent !== undefined && !wholeIn(s.depositPercent, 1, 100)) p.depositPercent = "Choose from 1 to 100 per cent.";
  if (s.depositOverToea !== undefined && !wholeIn(s.depositOverToea, 0, MAX_EDITABLE_TOEA)) p.depositOverToea = "Enter an amount of K0.00 or more.";
  if (s.quoteFollowUpDays !== undefined && !wholeIn(s.quoteFollowUpDays, 1, MAX_FOLLOW_UP_DAYS)) p.quoteFollowUpDays = `Choose from 1 to ${MAX_FOLLOW_UP_DAYS} days.`;
  return p;
}

/** D13: the org asks for a deposit on this total. */
export const depositApplies = (org: Pick<QuoteSettings, "depositPercent" | "depositOverToea">, totalToea: number): boolean =>
  org.depositPercent !== undefined && totalToea > (org.depositOverToea ?? 0);

// ---------------------------------------------------------------- sending

export type QuoteStatus = "sent" | "viewed" | "accepted" | "declined" | "expired" | "invoiced";

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
  sent: "Sent", viewed: "Viewed", accepted: "Accepted", declined: "Declined", expired: "Expired", invoiced: "Invoiced",
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
 * acceptance until anything is invoiced from it; a revision unless it is accepted (undo
 * that first) or invoiced.
 */
export function quoteAllows(q: QuoteState, now: Date, timezone: string): { readonly answer: boolean; readonly undo: boolean; readonly revise: boolean } {
  return {
    answer: (q.status === "sent" || q.status === "viewed") && !quoteExpired(q, now, timezone),
    undo: q.status === "accepted" && (q.invoiceIds ?? []).length === 0,
    revise: q.status !== "accepted" && q.status !== "invoiced",
  };
}

/** Why a quote takes no answer, or null when it does. `label` is "QUO-0012" or "QUO-0012 rev 2". */
export function noAnswerReason(q: QuoteState, label: string, now: Date, timezone: string): string | null {
  if (q.status === "accepted" || q.status === "invoiced") return `${label} was already accepted.`;
  if (q.status === "declined") return `${label} was already declined.`;
  if (q.status === "expired" || quoteExpired(q, now, timezone)) return `${label} expired on ${dateLabel(q.validUntil)}.`;
  return null;
}

// ---------------------------------------------------------------- revising (G2q-c)

/** A stored line back as typed: item lines carry their inputs; anything else is one unit at its amount. */
export const lineInputOf = (l: Line): ItemLineInput => ({
  description: l.description, detail: l.detail, quantityMilli: l.quantityMilli ?? 1000, unit: l.unit ?? "",
  unitPriceToea: l.unitPriceToea ?? l.amountToea, taxCode: l.taxCode ?? "standard",
});

const daysFrom = (from: CalendarDate, to: CalendarDate): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The draft Revise opens: the sent quote's customer, lines, notes and valid days, naming the quote. */
export function revisionDraftOf(
  q: Pick<IssuedQuote, "customerId" | "lines" | "issueDate" | "validUntil"> & { readonly notes: string },
  quoteId: string,
): QuoteDraft {
  return { customerId: q.customerId, lines: q.lines.map(lineInputOf), notes: q.notes, validDays: daysFrom(q.issueDate, q.validUntil), revises: quoteId };
}

// ---------------------------------------------------------------- converting to an invoice (G2q-c)

export type QuoteInvoiceKind = "full" | "deposit" | "final";

/** One invoice per kind per revision: the draft and the invoice it becomes share this id. */
export const quoteInvoiceId = (quoteId: string, revision: number, kind: QuoteInvoiceKind): string => `${quoteId}_r${revision}_${kind}`;

/** The quote an invoice or draft id was made from, or null for any other. */
export function quoteFromDraftId(id: string): { readonly quoteId: string; readonly revision: number; readonly kind: QuoteInvoiceKind } | null {
  const m = /^(.+)_r([1-9]\d*)_(full|deposit|final)$/.exec(id);
  return m === null ? null : { quoteId: m[1] as string, revision: Number(m[2]), kind: m[3] as QuoteInvoiceKind };
}

/** An accepted quote, as converting needs it. */
export interface AcceptedQuote extends Pick<IssuedQuote, "customerId" | "lines"> {
  readonly number: string;
  readonly revision: number;
  readonly notes: string;
  readonly acceptance: { readonly name: string; readonly poNumber: string; readonly acceptedOn: CalendarDate };
}

/** The share a deposit takes when the owner asks for one without a setting. */
export const DEFAULT_DEPOSIT_PERCENT = 50;
const NOTES_MAX = 500;

function invoiceNotes(q: AcceptedQuote): string {
  const said = `Quote ${quoteLabel(q.number, q.revision)}, accepted by ${q.acceptance.name} on ${dateLabel(q.acceptance.acceptedOn)}.`;
  const all = q.notes.trim() === "" ? said : `${said}\n${q.notes.trim()}`;
  return all.length <= NOTES_MAX ? all : `${all.slice(0, NOTES_MAX - 1)}…`;
}

/** Percent of an amount, rounded half away from zero to the toea, in integers. */
const share = (amount: number, percent: number): Toea =>
  toea(Math.sign(amount) * Math.floor((Math.abs(amount) * percent * 2 + 100) / 200) + 0);

const TAX_WORDS: Readonly<Record<TaxCode, string>> = { standard: "standard-rated", zero: "zero-rated", exempt: "GST-exempt" };
const TAX_ORDER: readonly TaxCode[] = ["standard", "zero", "exempt"];

/**
 * D14: the invoice draft an accepted quote becomes. In full, it has the quote's lines; as a
 * deposit (D13), one line per tax code the quote uses, at that share of the code's amount
 * before GST, so GST on the deposit is what it would be on that share of the work.
 */
export function invoiceDraftFromQuote(q: AcceptedQuote, kind: "full" | "deposit", org: Pick<QuoteSettings, "depositPercent">): OneOffDraft {
  const base = { customerId: q.customerId, poNumber: q.acceptance.poNumber, notes: invoiceNotes(q), dueDays: null };
  if (kind === "full") return { ...base, lines: q.lines.map(lineInputOf) };
  const percent = org.depositPercent ?? DEFAULT_DEPOSIT_PERCENT;
  const byCode = TAX_ORDER.map((code) => ({ code, amount: q.lines.filter((l) => (l.taxCode ?? "standard") === code).reduce((t, l) => t + l.amountToea, 0) }))
    .filter((g) => share(g.amount, percent) !== 0);
  const label = quoteLabel(q.number, q.revision);
  return {
    ...base,
    lines: byCode.map((g): ItemLineInput => ({
      description: `Deposit for ${label}`,
      detail: byCode.length > 1 ? `${percent}% of the ${TAX_WORDS[g.code]} work` : `${percent}% of the quoted work`,
      quantityMilli: 1000, unit: "", unitPriceToea: share(g.amount, percent), taxCode: g.code,
    })),
  };
}

/**
 * The final invoice after a deposit: the quote's lines, then the deposit invoice's lines (as
 * sent) taken off. A negative line's GST mirrors the charge, so the two invoices together
 * charge the quote's subtotal, GST and total exactly.
 */
export function finalDraftFromQuote(q: AcceptedQuote, deposit: { readonly number: string; readonly lines: readonly Line[] }): OneOffDraft {
  const less = deposit.lines.map((l): ItemLineInput => ({
    description: `Less deposit, ${deposit.number}`, detail: l.detail, quantityMilli: 1000, unit: "",
    unitPriceToea: toea(-l.amountToea + 0), taxCode: l.taxCode ?? "standard",
  }));
  return { ...invoiceDraftFromQuote(q, "full", {}), lines: [...q.lines.map(lineInputOf), ...less] };
}

/** Quoted vs invoiced: Invoiced once the invoices sent from it reach the accepted total; anything over is flagged. */
export function quoteInvoiced(q: { readonly acceptance?: { readonly totalToea: number }; readonly invoicedToea?: number }): { readonly invoiced: boolean; readonly overToea: number } {
  if (q.acceptance === undefined) return { invoiced: false, overToea: 0 };
  const invoiced = q.invoicedToea ?? 0;
  return { invoiced: invoiced >= q.acceptance.totalToea, overToea: Math.max(0, invoiced - q.acceptance.totalToea) };
}

// ---------------------------------------------------------------- the follow-up (G2q-c)

/** When the follow-up goes, fixed as the quote is sent; null when the org has it off. */
export const followUpAtOf = (sentAt: Date, org: Pick<QuoteSettings, "quoteFollowUpDays">): Date | null =>
  org.quoteFollowUpDays === undefined ? null : new Date(sentAt.getTime() + org.quoteFollowUpDays * 86_400_000);

/** One reminder per revision: unanswered, not past its day, its time come, and the setting still on. */
export function followUpDue(
  q: { readonly status: QuoteStatus; readonly validUntil: CalendarDate; readonly followUpAt: Date | null; readonly followedUp?: boolean },
  org: Pick<QuoteSettings, "quoteFollowUpDays">, now: Date, timezone: string,
): boolean {
  return org.quoteFollowUpDays !== undefined && q.followUpAt !== null && q.followedUp !== true
    && (q.status === "sent" || q.status === "viewed") && !quoteExpired(q, now, timezone) && q.followUpAt.getTime() <= now.getTime();
}
