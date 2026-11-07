/**
 * Billing rules (plan §3.4-§3.6): drafting, scheduling, the state machine and
 * reminders. Pure functions over plain data; every time-dependent rule takes `now`.
 */
import { documentTitle, gstOn, isTaxable } from "./gst.js";
import { type Toea, toea } from "./money.js";
import { addDays, day, firstDay, lastDay, localDate, nextPeriod, type Period, periodLabel, periodOf, shortCode, zonedInstant } from "./period.js";
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
      .map((charge) => line("extra", charge.description, charge.recurrence === "every" ? periodLabel(period) : "", charge.amountToea, charge.gstTreatment)),
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

/**
 * The same draft with a different rent this month (a part month, a waived month,
 * a privately agreed figure). Only the rent line changes; charges stay as configured.
 */
export function withRent(invoice: DraftInvoice, rentToea: Toea): DraftInvoice {
  if (rentToea < 0) throw new RangeError("rent cannot be negative");
  const lines = invoice.lines.map((l) =>
    l.kind === "rent" ? { ...l, amountToea: rentToea, gstToea: l.gstApplicable ? gstOn(rentToea) : toea(0) } : l,
  );
  return { ...invoice, lines, ...totals(lines) };
}

/** A validation message for an additional charge, or null. */
export function chargeProblem(charge: Pick<Charge, "recurrence" | "period">): string | null {
  if (charge.recurrence === "one" && charge.period === null) return "A one-month charge needs the month it applies to.";
  if (charge.recurrence === "every" && charge.period !== null) return "A recurring charge must not name a single month.";
  return null;
}

export interface ScheduleRequest {
  readonly org: Pick<BillingOrg, "timezone" | "sendHour">;
  readonly tenancies: readonly Tenancy[];
  readonly period: Period;
}

/** When a period's approved batch goes out: the earliest active billing day at the send hour, landlord time. */
export function sendAt({ org, tenancies, period }: ScheduleRequest): Date {
  const days = tenancies.filter((t) => isActiveIn(t, period)).map((t) => t.billingDay);
  const earliest = days.length > 0 ? Math.min(...days) : 1;
  return zonedInstant(day(period, earliest), org.sendHour, org.timezone);
}

export interface DraftingRequest {
  readonly org: Pick<BillingOrg, "timezone" | "sendHour" | "approvalLeadDays">;
  readonly tenancies: readonly Tenancy[];
  /** Periods that already have a run for this org. */
  readonly runPeriods: readonly Period[];
  readonly now: Date;
}

/** The periods the tick should draft now (plan §3.4). */
export function periodsToDraft({ org, tenancies, runPeriods, now }: DraftingRequest): Period[] {
  const thisMonth = periodOf(localDate(now, org.timezone)); // the landlord's month, not the server's
  const leadMs = org.approvalLeadDays * DAY_MS;
  return [thisMonth, nextPeriod(thisMonth)].filter((period) => {
    if (runPeriods.includes(period)) return false; // the tick never redrafts a run that exists
    if (!tenancies.some((t) => isActiveIn(t, period))) return false;
    const send = sendAt({ org, tenancies, period });
    return now.getTime() >= send.getTime() - leadMs && now.getTime() <= send.getTime();
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
