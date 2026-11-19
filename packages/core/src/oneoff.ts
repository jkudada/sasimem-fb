/**
 * One-off invoices (docs/PLAN-GENERAL-INVOICING.md G2a): the price list, a draft the
 * owner writes, and the invoice issuing makes of it. Pure; Functions number, freeze,
 * render and send. A one-off is never a draft inside invoices/ (test list G2, choices).
 */
import { totals } from "./billing.js";
import type { Customer } from "./customers.js";
import { documentTitle } from "./gst.js";
import { itemLine, itemLineProblems } from "./lines.js";
import { MAX_EDITABLE_TOEA, type Toea, formatKina, toea } from "./money.js";
import { addDays, type CalendarDate, periodOf } from "./period.js";
import { wholeIn } from "./setup.js";
import type { DraftInvoice, InvoiceSource, ItemLineInput, Problems, TaxCode } from "./types.js";

// ---------------------------------------------------------------- the price list

/** A saved service, material or labour rate: orgs/{orgId}/items/{id}. */
export interface Item {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly unitPriceToea: Toea;
  readonly taxCode: TaxCode;
}

export const TAX_CODES: readonly TaxCode[] = ["standard", "exempt", "zero"];

export function itemProblems(item: Item): Problems<keyof Item> {
  const p: Problems<keyof Item> = {};
  if (item.name.trim() === "") p.name = "Give the item a name.";
  else if (item.name.length > 100) p.name = "Keep the name to 100 characters or fewer.";
  if (item.description.length > 200) p.description = "Keep the description to 200 characters or fewer.";
  if (item.unit.length > 12) p.unit = "Keep the unit short, like hour, m or each.";
  if (!Number.isSafeInteger(item.unitPriceToea) || Math.abs(item.unitPriceToea) > MAX_EDITABLE_TOEA) {
    p.unitPriceToea = `Enter a price up to ${formatKina(toea(MAX_EDITABLE_TOEA))}.`;
  }
  if (!TAX_CODES.includes(item.taxCode)) p.taxCode = "Choose standard, exempt or zero-rated.";
  return p;
}

/** A draft line copied from an item: one unit, the item's price and tax code. Later edits are the line's own. */
export const lineFromItem = (item: Item): ItemLineInput => ({
  description: item.name, detail: item.description, quantityMilli: 1000, unit: item.unit, unitPriceToea: item.unitPriceToea, taxCode: item.taxCode,
});

// ---------------------------------------------------------------- the draft

/** What the owner is writing: orgs/{orgId}/drafts/{id}. */
export interface OneOffDraft {
  readonly customerId: string;
  readonly lines: readonly ItemLineInput[];
  readonly poNumber: string;
  readonly notes: string;
  /** Days to pay; null means the customer's terms, then the org's default. */
  readonly dueDays: number | null;
}

export const MAX_LINES = 30;

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number.NaN);

/**
 * A stored draft, read defensively. The rules check only the draft's shape and line count
 * (the 1,000-expression limit), so a line may be malformed: it reads as a line with problems
 * (NaN amounts, empty text), which draftProblems names. Never trusted, never a crash.
 */
export function draftOf(doc: Readonly<Record<string, unknown>>): OneOffDraft {
  const lines = Array.isArray(doc.lines) ? (doc.lines as unknown[]) : [];
  return {
    customerId: text(doc.customerId),
    lines: lines.map((raw): ItemLineInput => {
      const l = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      return {
        description: text(l.description), detail: text(l.detail), quantityMilli: num(l.quantityMilli), unit: text(l.unit),
        unitPriceToea: num(l.unitPriceToea) as Toea, taxCode: text(l.taxCode) as TaxCode,
      };
    }),
    poNumber: text(doc.poNumber),
    notes: text(doc.notes),
    dueDays: typeof doc.dueDays === "number" ? doc.dueDays : null,
  };
}
export const DEFAULT_TERMS_DAYS = 14;

/** What stops a draft being sent. `customer` is the record the draft names, or null if it is missing. */
export function draftProblems(draft: OneOffDraft, customer: Customer | null): Problems<keyof OneOffDraft> {
  const p: Problems<keyof OneOffDraft> = {};
  if (draft.customerId === "" || customer === null) p.customerId = "Choose who this invoice is for.";
  if (draft.lines.length === 0) p.lines = "Add at least one line.";
  else if (draft.lines.length > MAX_LINES) p.lines = `An invoice can have up to ${MAX_LINES} lines.`;
  else {
    const bad = draft.lines.findIndex((l) => Object.keys(itemLineProblems(l)).length > 0);
    if (bad >= 0) p.lines = `Line ${bad + 1}: ${Object.values(itemLineProblems(draft.lines[bad] as ItemLineInput))[0]}`;
    else if (totals(draft.lines.map((l) => itemLine(l, { gstRegistered: false }))).totalToea < 0) {
      p.lines = "The total is below K0.00. To give money back, issue a credit note instead.";
    }
  }
  if (draft.poNumber.length > 40) p.poNumber = "Keep the order number to 40 characters or fewer.";
  else if (customer?.poRequired === true && draft.poNumber.trim() === "") p.poNumber = "This customer pays only against an order number. Enter it.";
  if (draft.notes.length > 500) p.notes = "Keep the notes to 500 characters or fewer.";
  if (draft.dueDays !== null && !wholeIn(draft.dueDays, 0, 90)) p.dueDays = "Choose from 0 to 90 days.";
  return p;
}

/** Days to pay: the draft's own, else the customer's terms, else the org's default, else 14. */
export const dueDaysFor = (t: { draft: number | null; customer: number | null; org: number | undefined }): number =>
  t.draft ?? t.customer ?? t.org ?? DEFAULT_TERMS_DAYS;

// ---------------------------------------------------------------- issuing

export interface IssuedOneOff extends DraftInvoice {
  readonly source: InvoiceSource;
}

/**
 * The invoice a draft becomes when sent today (landlord time). Unnumbered: the
 * transaction numbers it with `numbered`, and the number is its payment reference.
 */
export function issuedOneOff(req: {
  draftId: string;
  draft: OneOffDraft;
  customer: Customer;
  org: { readonly gstRegistered: boolean; readonly defaultTermsDays?: number };
  today: CalendarDate;
}): IssuedOneOff {
  const lines = req.draft.lines.map((l) => itemLine(l, req.org));
  const due = dueDaysFor({ draft: req.draft.dueDays, customer: req.customer.termsDays, org: req.org.defaultTermsDays });
  return {
    tenancyId: "",
    period: periodOf(req.today),
    issueDate: req.today,
    dueDate: addDays(req.today, due),
    paymentReference: "",
    lines,
    ...totals(lines),
    documentTitle: documentTitle({ orgGstRegistered: req.org.gstRegistered, hasTaxableLine: lines.some((l) => l.gstApplicable) }),
    source: { kind: "oneOff", draftId: req.draftId },
  };
}

/** The invoice with its number, which is also what the customer writes on the transfer. */
export const numbered = (invoice: IssuedOneOff, number: string): IssuedOneOff => ({ ...invoice, paymentReference: number });
