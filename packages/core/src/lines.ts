/**
 * Invoice lines beyond rent (docs/PLAN-GENERAL-INVOICING.md §5.3): quantity × unit
 * price, a tax code, and where an invoice came from. Pure; integers only (I7).
 */
import { chargesGst, gstOn } from "./gst.js";
import { MAX_EDITABLE_TOEA, type Toea, formatKina, toea } from "./money.js";
import type { Period } from "./period.js";
import type { DraftInvoice, InvoiceSource, ItemLineInput, Line, Problems } from "./types.js";

// ---------------------------------------------------------------- quantities

/** Quantities are whole thousandths: 1.5 hours is 1500. */
export const QUANTITY_SCALE = 1000;

/** A million units: plenty for metres, litres or hours, and exact in every product below. */
export const MAX_QUANTITY = 1_000_000 * QUANTITY_SCALE;

/** Read a quantity the way someone types it ("1.5", "1,000"). A problem is a plain-English message. */
export function parseQuantity(text: string): number | { readonly problem: string } {
  const match = /^(?=\.?\d)(\d*)(?:\.(\d*))?$/.exec(text.replace(/[,\s]/g, ""));
  if (match === null) return { problem: "Enter a number, like 1 or 2.5." };
  const decimals = match[2] ?? "";
  if (decimals.length > 3) return { problem: "Use at most three decimal places." };
  const q = Number(match[1]) * QUANTITY_SCALE + Number((decimals + "000").slice(0, 3));
  if (q === 0) return { problem: "The quantity must be more than 0." };
  if (q > MAX_QUANTITY) return { problem: "The quantity must be at most 1,000,000." };
  return q;
}

/** 1500 → "1.5", 1000000 → "1,000": no trailing zeros, thousands grouped by hand (no ICU). */
export function formatQuantity(q: number): string {
  const whole = String(Math.trunc(q / QUANTITY_SCALE)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = String(q % QUANTITY_SCALE).padStart(3, "0").replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

// ---------------------------------------------------------------- amounts

/**
 * Quantity × unit price, rounded half away from zero to the toea (as parseKina rounds).
 * In BigInt: a million units at K10,000,000 is 10^18, past what a double holds exactly.
 */
export function lineAmount(quantityMilli: number, unitPriceToea: Toea): Toea {
  const scale = BigInt(QUANTITY_SCALE);
  const magnitude = (BigInt(quantityMilli) * BigInt(Math.abs(unitPriceToea)) * 2n + scale) / (2n * scale);
  return toea(Number(unitPriceToea < 0 ? -magnitude : magnitude) + 0); // "+ 0": no -0
}

/** An item line with its amount and GST worked out (GST on the rounded amount, per line). */
export function itemLine(input: ItemLineInput, org: { readonly gstRegistered: boolean }): Line {
  const amountToea = lineAmount(input.quantityMilli, input.unitPriceToea);
  const gstApplicable = chargesGst(input.taxCode, org.gstRegistered);
  return {
    kind: "item",
    description: input.description,
    detail: input.detail,
    quantityMilli: input.quantityMilli,
    unit: input.unit,
    unitPriceToea: input.unitPriceToea,
    taxCode: input.taxCode,
    amountToea,
    gstApplicable,
    gstToea: gstApplicable ? gstOn(amountToea) : toea(0),
  };
}

export type ItemLineField = "description" | "detail" | "quantity" | "unit" | "unitPrice";

/** What is wrong with an item line as typed. Empty when it is fine. */
export function itemLineProblems(input: ItemLineInput): Problems<ItemLineField> {
  const problems: Problems<ItemLineField> = {};
  const description = input.description.trim();
  if (description === "") problems.description = "Say what this line is for.";
  else if (description.length > 200) problems.description = "Keep the description to 200 characters.";
  if (input.detail.length > 200) problems.detail = "Keep the detail to 200 characters.";
  if (input.unit.length > 12) problems.unit = "Keep the unit short, like hour, m or each.";
  if (!Number.isSafeInteger(input.quantityMilli) || input.quantityMilli <= 0 || input.quantityMilli > MAX_QUANTITY) {
    problems.quantity = "The quantity must be more than 0 and at most 1,000,000.";
  } else if (Math.abs(lineAmount(input.quantityMilli, input.unitPriceToea)) > MAX_EDITABLE_TOEA) {
    problems.unitPrice = `This line comes to more than ${formatKina(toea(MAX_EDITABLE_TOEA))}. Check the price and quantity.`;
  }
  return problems;
}

// ---------------------------------------------------------------- sources

/** Where an invoice came from. Invoices drafted before G1 carry no source: they are rent. */
export function sourceOf(invoice: { readonly tenancyId: string; readonly period: Period; readonly source?: InvoiceSource }): InvoiceSource {
  return invoice.source ?? { kind: "rent", tenancyId: invoice.tenancyId, period: invoice.period };
}

/** The source written on a newly drafted rent invoice. */
export const rentSource = (draft: Pick<DraftInvoice, "tenancyId" | "period">): InvoiceSource =>
  ({ kind: "rent", tenancyId: draft.tenancyId, period: draft.period });
