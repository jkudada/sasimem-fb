/**
 * Billing rules (plan §3.4-§3.6): drafting, scheduling, the state machine and
 * reminders. Pure functions over plain data; every time-dependent rule takes `now`.
 */
import { toea } from "./money.js";
import { addDays, day, firstDay, lastDay, type Period, periodLabel, shortCode } from "./period.js";
import type { BillingOrg, Charge, DraftInvoice, Line, Tenancy, Totals } from "./types.js";

/** A tenancy is billed in a period if it overlaps that month at all. */
export function isActiveIn(tenancy: Tenancy, period: Period): boolean {
  if (tenancy.startDate > lastDay(period)) return false;
  return tenancy.endDate === null || tenancy.endDate >= firstDay(period);
}

/** Whether an additional charge is billed in this period. */
export function chargeApplies(charge: Charge, period: Period): boolean {
  if (!charge.active) return false;
  return charge.recurrence === "every" || charge.period === period;
}

/** What the tenant writes on the bank deposit, e.g. WARI-OCT26. */
export function paymentReference(tenancy: Tenancy, period: Period): string {
  return `${tenancy.referenceCode.toUpperCase()}-${shortCode(period)}`;
}

/** "1 - 31 October 2026": the span a rent line covers. */
function rentDetail(period: Period): string {
  const dayOf = (d: string) => Number(d.slice(8, 10));
  return `${dayOf(firstDay(period))} - ${dayOf(lastDay(period))} ${periodLabel(period)}`;
}

/** Totals are always recomputed from the lines, never adjusted incrementally. */
export function totals(lines: readonly Line[]): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.amountToea, 0);
  const gst = lines.reduce((sum, l) => sum + l.gstToea, 0);
  return { subtotalToea: toea(subtotal), gstToea: toea(gst), totalToea: toea(subtotal + gst) };
}

export interface DraftRequest {
  readonly org: Pick<BillingOrg, "gstRegistered">;
  readonly tenancy: Tenancy;
  readonly period: Period;
}

/** The invoice a tenancy should get for a period, from current tenancy data. */
export function draftInvoice({ tenancy, period }: DraftRequest): DraftInvoice {
  const issueDate = day(period, tenancy.billingDay);
  const lines: Line[] = [
    { kind: "rent", description: `Rent - ${tenancy.unitLabel}`, detail: rentDetail(period), amountToea: tenancy.rentToea, gstApplicable: false, gstToea: toea(0) },
  ];
  return {
    tenancyId: tenancy.id,
    period,
    issueDate,
    dueDate: addDays(issueDate, tenancy.dueDays),
    paymentReference: paymentReference(tenancy, period),
    lines,
    ...totals(lines),
    documentTitle: "INVOICE",
  };
}
