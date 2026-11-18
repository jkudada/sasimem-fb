/**
 * Step 6: what tracking, the owed screen and the export need that is pure - the
 * chip an invoice shows, arrears grouped by tenant, a month's paid count, the void
 * and note rules, and the CSV. Nothing here does I/O.
 */
import type { Toea } from "./money.js";
import { type CalendarDate, type Period, shiftPeriod } from "./period.js";
import type { InvoiceStatus } from "./types.js";

/** An invoice as the tracking and owed views see it. */
export interface IssuedInvoice {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly number: string | null;
  readonly period: Period;
  readonly status: InvoiceStatus;
  readonly dueDate: CalendarDate;
  readonly totalToea: Toea;
}

export type Chip = "Paid" | "Not paid" | "Overdue" | "Void" | "Left out" | "Draft" | "Approved";

const CHIPS: Record<Exclude<InvoiceStatus, "sent">, Chip> = { paid: "Paid", void: "Void", excluded: "Left out", draft: "Draft", approved: "Approved" };

/** Where an invoice stands, in the landlord's words. Overdue is after the due date, on the landlord's calendar. */
export function invoiceChip(invoice: Pick<IssuedInvoice, "status" | "dueDate">, today: CalendarDate): Chip {
  if (invoice.status !== "sent") return CHIPS[invoice.status];
  return today > invoice.dueDate ? "Overdue" : "Not paid";
}

export interface Arrears<I extends IssuedInvoice = IssuedInvoice> {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly oldestDue: CalendarDate;
  readonly totalToea: number;
  readonly invoices: readonly I[];
}

const byDue = (a: IssuedInvoice, b: IssuedInvoice) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);

/** Everything sent and unpaid, grouped by tenant, the tenant owing longest first (plan §7, screen 6). */
export function arrears<I extends IssuedInvoice>(invoices: readonly I[]): Arrears<I>[] {
  const groups = new Map<string, I[]>();
  for (const i of invoices.filter((x) => x.status === "sent").sort(byDue)) groups.set(i.tenantId, [...(groups.get(i.tenantId) ?? []), i]);
  return [...groups.values()]
    .map((list) => {
      const first = list[0] as I;
      return { tenantId: first.tenantId, tenantName: first.tenantName, oldestDue: first.dueDate, totalToea: list.reduce((t, i) => t + i.totalToea, 0), invoices: list };
    })
    .sort((a, b) => (a.oldestDue < b.oldestDue ? -1 : a.oldestDue > b.oldestDue ? 1 : a.tenantName.localeCompare(b.tenantName)));
}

export const owedTotal = (groups: readonly Arrears[]): number => groups.reduce((t, g) => t + g.totalToea, 0);

/** Of a month's issued invoices (sent or paid), how many are paid, and what is still unpaid. */
export function paidSummary(invoices: readonly Pick<IssuedInvoice, "status" | "totalToea">[]): { paid: number; issued: number; unpaidToea: number } {
  const issued = invoices.filter((i) => i.status === "sent" || i.status === "paid");
  return {
    paid: issued.filter((i) => i.status === "paid").length,
    issued: issued.length,
    unpaidToea: issued.filter((i) => i.status === "sent").reduce((t, i) => t + i.totalToea, 0),
  };
}

/** A draft is left out, not voided; only an issued invoice is voided, and it keeps its number. */
export const canVoid = (status: InvoiceStatus): boolean => status === "approved" || status === "sent" || status === "paid";

const NOTE_MAX = 200;

export function voidReasonProblem(reason: string): string | null {
  if (reason.trim() === "") return "Say why this invoice is void.";
  return reason.length > NOTE_MAX ? "Keep the reason under 200 characters." : null;
}

export const paidNoteProblem = (note: string): string | null => (note.length > NOTE_MAX ? "Keep the note under 200 characters." : null);

export const MAX_EXPORT_MONTHS = 24;

export function exportRangeProblem(from: Period, to: Period): string | null {
  if (from > to) return "The first month must come before the last.";
  return shiftPeriod(from, MAX_EXPORT_MONTHS - 1) < to ? "Export at most 24 months at a time." : null;
}

// ---------------------------------------------------------------- CSV (PLAN.md rec. 7)

export interface CsvRow {
  readonly number: string;
  readonly issueDate: CalendarDate;
  readonly dueDate: CalendarDate;
  readonly period: Period;
  readonly tenantName: string;
  readonly unitLabel: string;
  readonly paymentReference: string;
  readonly subtotalToea: Toea;
  readonly gstToea: Toea;
  readonly totalToea: Toea;
  readonly status: InvoiceStatus;
  readonly paidOn: CalendarDate | null;
  readonly paidNote: string;
  readonly voidReason: string;
}

const HEADER = ["Number", "Issue date", "Due date", "Month", "Tenant", "Unit", "Payment reference", "Subtotal", "GST", "Total", "Status", "Paid on", "Paid note", "Void reason"];
const STATUS: Record<InvoiceStatus, string> = { draft: "Draft", excluded: "Left out", approved: "Approved", sent: "Sent", paid: "Paid", void: "Void" };

/** 120050 → "1200.50": a spreadsheet reads it as a number, with no currency symbol or grouping. */
export function csvDecimal(amount: number): string {
  const abs = Math.abs(amount);
  return `${amount < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Text a person typed: quoted when it must be, and never run as a formula by a spreadsheet. */
export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function invoicesCsv(rows: readonly CsvRow[]): string {
  const lines = rows.map((r) => [
    csvText(r.number), r.issueDate, r.dueDate, r.period, csvText(r.tenantName), csvText(r.unitLabel), csvText(r.paymentReference),
    csvDecimal(r.subtotalToea), csvDecimal(r.gstToea), csvDecimal(r.totalToea), STATUS[r.status], r.paidOn ?? "", csvText(r.paidNote), csvText(r.voidReason),
  ].join(","));
  return [HEADER.join(","), ...lines, ""].join("\r\n");
}
