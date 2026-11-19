/**
 * Credit notes (docs/PLAN-GENERAL-INVOICING.md AR-3, §5.3; G2c). An issued invoice never
 * changes: money comes off it by a credit note, chosen line by line. A line's GST follows
 * the line, and the last of a line takes the last of its GST, so however many credit notes
 * it takes, crediting everything matches the invoice to the toea. Pure: Functions number
 * it (CN-) and write the invoice, the credit note and the customer's credit in one
 * transaction.
 */
import { gstOn } from "./gst.js";
import { formatKina, type Toea, toea } from "./money.js";
import { balanceOf } from "./receipts.js";
import type { InvoiceStatus, Line, Problems, Totals } from "./types.js";

/** What earlier credit notes took from one line of an invoice. */
export interface CreditedLine {
  readonly amountToea: Toea;
  readonly gstToea: Toea;
}

/** One line of a credit note as asked for: which invoice line, and how much before GST. */
export interface CreditLineInput {
  readonly lineIndex: number;
  readonly amountToea: Toea;
}

export interface CreditNoteInput {
  readonly invoiceId: string;
  readonly reason: string;
  readonly lines: readonly CreditLineInput[];
}

/** An invoice as credit notes see it. The three credit fields are absent until the first credit note. */
export interface CreditableInvoice {
  readonly number: string | null;
  readonly status: InvoiceStatus;
  readonly lines: readonly Line[];
  readonly totalToea: Toea;
  readonly documentTitle: "INVOICE" | "TAX INVOICE";
  readonly amountPaidToea?: Toea;
  readonly creditedToea?: Toea;
  readonly creditNotedLines?: readonly CreditedLine[];
  readonly creditNotedToea?: Toea;
}

export type CreditNoteTitle = "CREDIT NOTE" | "TAX CREDIT NOTE";

const NONE: CreditedLine = { amountToea: toea(0), gstToea: toea(0) };

const doneOn = (inv: Pick<CreditableInvoice, "creditNotedLines">, index: number): CreditedLine => inv.creditNotedLines?.[index] ?? NONE;

/** What is left to credit on a line: its amount and GST less what earlier credit notes took. */
export function leftOnLine(line: Line, done: CreditedLine = NONE): CreditedLine {
  return { amountToea: toea(line.amountToea - done.amountToea), gstToea: toea(line.gstToea - done.gstToea) };
}

/**
 * The GST on crediting `amount` of a line: none on an untaxed line; the rest of its GST
 * when this is the rest of the line; else 10%, never past what GST is left.
 */
export function creditGst(line: Line, done: CreditedLine, amount: Toea): Toea {
  if (!line.gstApplicable) return toea(0);
  const left = leftOnLine(line, done);
  if (amount === left.amountToea) return left.gstToea;
  const gst = gstOn(amount);
  return Math.abs(gst) > Math.abs(left.gstToea) ? left.gstToea : gst;
}

/** "Credit the whole invoice": every line's remainder. Lines already fully credited are left out. */
export function wholeInvoice(inv: Pick<CreditableInvoice, "lines" | "creditNotedLines">): CreditLineInput[] {
  return inv.lines.flatMap((line, lineIndex) => {
    const left = leftOnLine(line, doneOn(inv, lineIndex)).amountToea;
    return left === 0 ? [] : [{ lineIndex, amountToea: left }];
  });
}

/** Whether `amount` can be credited on a line: of the line's sign, not 0, at most what is left. */
function lineProblem(line: Line, done: CreditedLine, amount: Toea): string | null {
  const left = leftOnLine(line, done).amountToea;
  if (!Number.isSafeInteger(amount) || amount === 0) return `Enter how much of "${line.description}" to credit, or leave it out.`;
  if (left === 0) return `"${line.description}" has been credited in full already.`;
  if (Math.sign(amount) !== Math.sign(left)) {
    return left < 0 ? `"${line.description}" is a discount: credit it as a negative amount.` : `Credit "${line.description}" as a positive amount.`;
  }
  return Math.abs(amount) > Math.abs(left) ? `Only ${formatKina(left)} of "${line.description}" is left to credit.` : null;
}

/** What stops this credit note. The server passes the invoice as read in its transaction. */
export function creditNoteProblems(input: CreditNoteInput, inv: CreditableInvoice): Problems<"reason" | "lines"> {
  const problems: Problems<"reason" | "lines"> = {};
  const reason = input.reason.trim();
  if (reason === "") problems.reason = "Say why you are crediting this invoice. It prints on the credit note.";
  else if (reason.length > 200) problems.reason = "Keep the reason to 200 characters or fewer.";
  const lines = linesProblem(input, inv);
  if (lines !== null) problems.lines = lines;
  return problems;
}

function linesProblem(input: CreditNoteInput, inv: CreditableInvoice): string | null {
  if (inv.number === null || (inv.status !== "sent" && inv.status !== "paid")) return "Only a sent or paid invoice can be credited.";
  if (input.lines.length === 0) return "Choose what to credit.";
  const seen = new Set<number>();
  for (const l of input.lines) {
    const line = Number.isSafeInteger(l.lineIndex) ? inv.lines[l.lineIndex] : undefined;
    if (line === undefined) return "One of these lines is not on the invoice. Reload and try again.";
    if (seen.has(l.lineIndex)) return `"${line.description}" is listed twice.`;
    seen.add(l.lineIndex);
    const problem = lineProblem(line, doneOn(inv, l.lineIndex), l.amountToea);
    if (problem !== null) return problem;
  }
  const total = creditNoteLines(input, inv).totals.totalToea;
  if (total <= 0) return "A credit note must come to more than K0.00.";
  const left = inv.totalToea - (inv.creditNotedToea ?? 0);
  return total > left ? `Only ${formatKina(toea(left))} of ${inv.number} is left to credit.` : null;
}

/** A credit note's printed lines: the invoice's own words, the amounts and GST credited. */
export function creditNoteLines(input: Pick<CreditNoteInput, "lines">, inv: Pick<CreditableInvoice, "lines" | "creditNotedLines">): { lines: Line[]; totals: Totals } {
  const lines = input.lines.map(({ lineIndex, amountToea }): Line => {
    const line = inv.lines[lineIndex] as Line;
    return {
      kind: line.kind, description: line.description, detail: line.detail, amountToea, gstApplicable: line.gstApplicable,
      gstToea: creditGst(line, doneOn(inv, lineIndex), amountToea), ...(line.taxCode === undefined ? {} : { taxCode: line.taxCode }),
    };
  });
  const subtotal = lines.reduce((t, l) => t + l.amountToea, 0);
  const gst = lines.reduce((t, l) => t + l.gstToea, 0);
  return { lines, totals: { subtotalToea: toea(subtotal), gstToea: toea(gst), totalToea: toea(subtotal + gst) } };
}

/** A tax invoice is credited by a tax credit note. */
export const creditNoteTitle = (inv: Pick<CreditableInvoice, "documentTitle">): CreditNoteTitle =>
  inv.documentTitle === "TAX INVOICE" ? "TAX CREDIT NOTE" : "CREDIT NOTE";

/**
 * The invoice after a credit note (already checked), and where the money went: off the
 * balance first (`appliedToea`), the rest to the customer's credit (`creditToea`).
 */
export function afterCreditNote(inv: CreditableInvoice, input: Pick<CreditNoteInput, "lines">): {
  readonly lines: Line[];
  readonly totals: Totals;
  readonly appliedToea: Toea;
  readonly creditToea: Toea;
  readonly invoice: { readonly creditNotedLines: CreditedLine[]; readonly creditNotedToea: Toea; readonly creditedToea: Toea; readonly status: "sent" | "paid" };
} {
  const { lines, totals } = creditNoteLines(input, inv);
  const noted = inv.lines.map((_, n) => doneOn(inv, n));
  input.lines.forEach(({ lineIndex }, n) => {
    const was = noted[lineIndex] as CreditedLine;
    const now = lines[n] as Line;
    noted[lineIndex] = { amountToea: toea(was.amountToea + now.amountToea), gstToea: toea(was.gstToea + now.gstToea) };
  });
  const balance = balanceOf(inv);
  const appliedToea = toea(Math.min(balance, totals.totalToea));
  const creditedToea = toea((inv.creditedToea ?? 0) + appliedToea);
  return {
    lines, totals, appliedToea, creditToea: toea(totals.totalToea - appliedToea),
    invoice: {
      creditNotedLines: noted, creditNotedToea: toea((inv.creditNotedToea ?? 0) + totals.totalToea), creditedToea,
      status: inv.status === "paid" || balance - appliedToea === 0 ? "paid" : "sent",
    },
  };
}

/** True once a credit note has been issued against it. */
export const hasCreditNotes = (i: Pick<CreditableInvoice, "creditNotedToea">): boolean => (i.creditNotedToea ?? 0) > 0;
