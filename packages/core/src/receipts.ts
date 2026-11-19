/**
 * Part payments and receipts (docs/PLAN-GENERAL-INVOICING.md AR-5, AR-10; G2b). Money
 * received from a customer is applied to their open invoices, oldest first unless the
 * owner says otherwise; what is left over is credit. Pure: Functions number the receipt
 * (RCT-) and write the invoices in one transaction.
 */
import { amountProblem, formatKina, type Toea, toea } from "./money.js";
import { type CalendarDate, parseCalendarDate } from "./period.js";
import type { InvoiceStatus, Problems } from "./types.js";

export const PAYMENT_METHODS = ["bank", "cash", "cheque", "card", "mobile", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  bank: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card (EFTPOS)", mobile: "Mobile money", other: "Other",
};

/** At most this many invoices per payment: one transaction reads and writes each. */
export const MAX_ALLOCATIONS = 20;

export interface PaymentAllocation {
  readonly invoiceId: string;
  readonly amountToea: Toea;
}

/** What the owner records: who paid, when, how much and how, and what it pays. */
export interface PaymentInput {
  readonly customerId: string;
  readonly receivedOn: CalendarDate;
  readonly amountToea: Toea;
  readonly method: PaymentMethod;
  readonly reference: string;
  readonly note: string;
  readonly allocations: readonly PaymentAllocation[];
  /** Customer credit used as well as the money received (G2c); absent means none. */
  readonly creditUsedToea?: Toea;
}

/** An invoice as payments see it. `amountPaidToea` is absent on invoices from before G2b. */
export interface OpenInvoice {
  readonly id: string;
  /** Every sent invoice has one; "" for the rest, which owe nothing. */
  readonly number: string;
  readonly customerId: string;
  readonly status: InvoiceStatus;
  readonly dueDate: CalendarDate;
  readonly totalToea: Toea;
  readonly amountPaidToea?: Toea;
  /** Taken off its balance by credit notes (G2c); absent means none. */
  readonly creditedToea?: Toea;
}

type Paid = Pick<OpenInvoice, "status" | "totalToea" | "amountPaidToea" | "creditedToea">;

/** What has been paid: as recorded; an invoice ticked paid before G2b, with nothing recorded, in full. */
export function paidSoFar(i: Paid): Toea {
  if (i.amountPaidToea !== undefined) return i.amountPaidToea;
  return i.status === "paid" ? i.totalToea : toea(0);
}

/** What is still owed: less payments and credit notes. Only a sent invoice owes anything: void and unissued ones owe nothing. */
export const balanceOf = (i: Paid): Toea => (i.status === "sent" ? toea(i.totalToea - paidSoFar(i) - (i.creditedToea ?? 0)) : toea(0));

/** True once a payment has been recorded against it (a plain paid tick does not count). */
export const hasPayments = (i: Pick<OpenInvoice, "amountPaidToea">): boolean => (i.amountPaidToea ?? 0) > 0;

const oldestDue = (a: OpenInvoice, b: OpenInvoice) =>
  a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.number.localeCompare(b.number);

/** The usual proposal: the longest owing first, each up to its balance; what is left is credit. */
export function oldestFirst(amount: Toea, open: readonly OpenInvoice[]): { allocations: PaymentAllocation[]; creditToea: Toea } {
  let left: number = amount;
  const allocations: PaymentAllocation[] = [];
  for (const i of [...open].sort(oldestDue)) {
    const take = Math.min(left, balanceOf(i));
    if (take <= 0) continue;
    allocations.push({ invoiceId: i.id, amountToea: toea(take) });
    left -= take;
  }
  return { allocations, creditToea: toea(left) };
}

const appliedTotal = (p: Pick<PaymentInput, "allocations">): Toea => toea(p.allocations.reduce((t, a) => t + a.amountToea, 0));

/** The credit a payment makes: what was received and credit used, less what it applied. */
export const creditOf = (p: Pick<PaymentInput, "amountToea" | "allocations" | "creditUsedToea">): Toea =>
  toea(p.amountToea + (p.creditUsedToea ?? 0) - appliedTotal(p));

const validDate = (d: string): boolean => {
  try {
    parseCalendarDate(d);
    return true;
  } catch {
    return false;
  }
};

/**
 * What stops a payment being recorded. `open` is the customer's invoices and `credit` their
 * credit as they stand now; the server passes what it read in the transaction, so two
 * payments cannot overpay one invoice or use the same credit.
 */
export function paymentProblems(p: PaymentInput, open: readonly OpenInvoice[], today: CalendarDate, credit: Toea = toea(0)): Problems<keyof PaymentInput> {
  const problems: Problems<keyof PaymentInput> = {};
  if (p.customerId === "") problems.customerId = "Choose who paid.";
  if (!validDate(p.receivedOn)) problems.receivedOn = "Enter the date it was received.";
  else if (p.receivedOn > today) problems.receivedOn = "A payment cannot be received in the future.";
  const used = p.creditUsedToea ?? 0;
  if (!Number.isSafeInteger(used) || used < 0) problems.creditUsedToea = "Enter how much credit to use.";
  else if (used > credit) problems.creditUsedToea = credit > 0 ? `They have only ${formatKina(credit)} in credit.` : "They have no credit to use.";
  else if (used > appliedTotal(p)) problems.creditUsedToea = "Use no more credit than you apply to invoices.";
  if (!Number.isSafeInteger(p.amountToea) || p.amountToea < 0 || (p.amountToea === 0 && used <= 0)) problems.amountToea = "Enter the amount received.";
  else {
    const tooBig = amountProblem(p.amountToea);
    if (tooBig !== null) problems.amountToea = tooBig;
  }
  if (!(PAYMENT_METHODS as readonly string[]).includes(p.method)) problems.method = "Choose how it was paid.";
  if (p.reference.length > 40) problems.reference = "Keep the reference to 40 characters or fewer.";
  if (p.note.length > 200) problems.note = "Keep the note to 200 characters or fewer.";
  const allocation = allocationProblem(p, open);
  if (allocation !== null) problems.allocations = allocation;
  return problems;
}

function allocationProblem(p: PaymentInput, open: readonly OpenInvoice[]): string | null {
  if (p.allocations.length > MAX_ALLOCATIONS) return `A payment can be applied to up to ${MAX_ALLOCATIONS} invoices.`;
  const seen = new Set<string>();
  for (const a of p.allocations) {
    const i = open.find((x) => x.id === a.invoiceId);
    if (i === undefined || i.customerId !== p.customerId || i.status !== "sent") return "One of these invoices is no longer open for this customer. Reload and try again.";
    if (seen.has(a.invoiceId)) return `${i.number} is listed twice.`;
    seen.add(a.invoiceId);
    if (!Number.isSafeInteger(a.amountToea) || a.amountToea <= 0) return "Each amount applied must be more than K0.00.";
    if (a.amountToea > balanceOf(i)) return `${i.number} has only ${formatKina(balanceOf(i))} left to pay.`;
  }
  const applied = appliedTotal(p);
  const used = Number.isSafeInteger(p.creditUsedToea ?? 0) ? (p.creditUsedToea ?? 0) : 0;
  if (Number.isSafeInteger(p.amountToea) && applied > p.amountToea + used) {
    const from = used > 0 ? `the ${formatKina(p.amountToea)} received and ${formatKina(toea(used))} of credit` : `the ${formatKina(p.amountToea)} received`;
    return `You have applied ${formatKina(applied)}, more than ${from}.`;
  }
  return null;
}

/**
 * An invoice after `amount` more is paid on it (negative: a payment undone). Paid at a
 * balance of 0, otherwise sent. Never below 0 or above the total: that is a bug, not a choice.
 */
export function applied(i: Paid, amount: Toea): { amountPaidToea: Toea; status: "sent" | "paid" } {
  const paid = paidSoFar(i) + amount;
  const payable = i.totalToea - (i.creditedToea ?? 0);
  if (paid < 0 || paid > payable) throw new RangeError(`paid ${paid} outside 0..${payable}`);
  return { amountPaidToea: toea(paid), status: paid === payable ? "paid" : "sent" };
}

export function undoReasonProblem(reason: string): string | null {
  if (reason.trim() === "") return "Say why this payment is being undone.";
  return reason.length > 200 ? "Keep the reason to 200 characters or fewer." : null;
}
