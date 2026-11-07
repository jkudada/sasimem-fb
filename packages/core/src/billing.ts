/**
 * Billing rules (plan §3.4-§3.6): drafting, scheduling, the state machine and
 * reminders. Pure functions over plain data; every time-dependent rule takes `now`.
 */
import { documentTitle, gstOn, isTaxable } from "./gst.js";
import { type Toea, toea } from "./money.js";
import { addDays, day, firstDay, lastDay, type Period, periodLabel, shortCode } from "./period.js";
import type { BillingOrg, Charge, DraftInvoice, GstTreatment, Line, LineKind, Tenancy, Totals } from "./types.js";

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
export function draftInvoice({ org, tenancy, period }: DraftRequest): DraftInvoice {
  const issueDate = day(period, tenancy.billingDay);
  const line = (kind: LineKind, description: string, detail: string, amountToea: Toea, treatment: GstTreatment): Line => {
    const gstApplicable = isTaxable({ orgGstRegistered: org.gstRegistered, useType: tenancy.useType, treatment });
    return { kind, description, detail, amountToea, gstApplicable, gstToea: gstApplicable ? gstOn(amountToea) : toea(0) };
  };
  const lines: Line[] = [
    line("rent", `Rent - ${tenancy.unitLabel}`, rentDetail(period), tenancy.rentToea, "inherit"),
    ...tenancy.extras
      .filter((charge) => chargeApplies(charge, period))
      .map((charge) => line("extra", charge.description, periodLabel(period), charge.amountToea, charge.gstTreatment)),
  ];
  return {
    tenancyId: tenancy.id,
    period,
    issueDate,
    dueDate: addDays(issueDate, tenancy.dueDays),
    paymentReference: paymentReference(tenancy, period),
    lines,
    ...totals(lines),
    documentTitle: documentTitle({ orgGstRegistered: org.gstRegistered, hasTaxableLine: lines.some((l) => l.gstApplicable) }),
  };
}
