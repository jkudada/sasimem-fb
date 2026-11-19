/**
 * Quotes (docs/PLAN-GENERAL-INVOICING.md §3.3, D11-D18; test list general-g2q.md). The
 * owner writes a draft; sending numbers it (`QUO-`), freezes it and emails it. Pure;
 * Functions number, freeze, render and send. A quote is not a tax document.
 */
import { totals } from "./billing.js";
import type { Customer } from "./customers.js";
import { itemLine } from "./lines.js";
import { lineOf, linesProblem } from "./oneoff.js";
import { addDays, type CalendarDate } from "./period.js";
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
