/**
 * Billing rules (plan §3.4-§3.6): drafting, scheduling, the state machine and
 * reminders. Pure functions over plain data; every time-dependent rule takes `now`.
 */
import { documentTitle, gstOn, isTaxable } from "./gst.js";
import { type Toea, toea } from "./money.js";
import { addDays, type CalendarDate, day, firstDay, lastDay, localDate, nextPeriod, type Period, periodLabel, periodOf, shortCode, zonedInstant } from "./period.js";
import type { BillingOrg, Charge, DraftInvoice, GstTreatment, Line, InvoiceStatus, LineKind, RunStatus, Tenancy, Totals } from "./types.js";

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
    const send = sendAt({ org, tenancies, period }).getTime();
    if (now.getTime() < send - leadMs) return false; // too early: the landlord need not think about it yet
    if (now.getTime() > send) {
      // The send time has passed. If the org was already billing before this month,
      // that is a scheduler outage: draft it, so the tick holds it and the landlord
      // hears. With no earlier run it is onboarding, and conjuring a held batch for
      // a month already invoiced by hand would be noise. "Earlier", not "any": next
      // month's run must not make this month look like history.
      return runPeriods.some((r) => r < period);
    }
    return true;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- the state machine (§3.5)

const EDITABLE: ReadonlySet<RunStatus> = new Set(["draft", "awaitingApproval", "held"]);

/** Invoices in an editable run may be excluded, re-included, re-priced or rebuilt. */
export const isEditable = (status: RunStatus): boolean => EDITABLE.has(status);

export interface ScheduledRun {
  readonly status: RunStatus;
  readonly sendAt: Date;
}

/** Tick step 2: a draft run moves to awaitingApproval once its lead time begins. */
export function approvalRequestDue(run: ScheduledRun, org: Pick<BillingOrg, "approvalLeadDays">, now: Date): boolean {
  return run.status === "draft" && now.getTime() >= run.sendAt.getTime() - org.approvalLeadDays * DAY_MS;
}

/** Tick step 3: only an approved run is ever released to tenants, and only at its send time (I6). */
export const releaseDue = (run: ScheduledRun, now: Date): boolean =>
  run.status === "approved" && now.getTime() >= run.sendAt.getTime();

/** Tick step 4: a run not approved by its send time is held, never sent. */
export const holdDue = (run: ScheduledRun, now: Date): boolean =>
  run.status === "awaitingApproval" && now.getTime() >= run.sendAt.getTime();

export type ApprovalOutcome = "approve" | "alreadyApproved" | "refused";

/** What an approval attempt should do, given the run's current status (§6.3 step 1). */
export function approvalOutcome(status: RunStatus): ApprovalOutcome {
  if (status === "approved" || status === "sent") return "alreadyApproved";
  return isEditable(status) ? "approve" : "refused";
}

export const canExclude = (run: RunStatus, invoice: InvoiceStatus): boolean => isEditable(run) && invoice === "draft";
export const canInclude = (run: RunStatus, invoice: InvoiceStatus): boolean => isEditable(run) && invoice === "excluded";

/** A rule refused an action; callers turn it into a plain-English message. */
export class NotAllowed extends Error {
  override readonly name = "NotAllowed";
}

export interface PaymentState {
  readonly status: InvoiceStatus;
  readonly paidAt: Date | null;
}

/** Tick an invoice paid. Emails nobody (§3.5). */
export function markPaid(invoice: PaymentState, now: Date): PaymentState {
  if (invoice.status === "paid") return invoice;
  if (invoice.status !== "sent") throw new NotAllowed(`an invoice that is ${invoice.status} cannot be marked paid`);
  return { status: "paid", paidAt: now };
}

/** Reverse a paid tick. Emails nobody, and leaves remindedAt alone (§3.5). */
export function markUnpaid(invoice: PaymentState): PaymentState {
  return invoice.status === "paid" ? { status: "sent", paidAt: null } : invoice;
}

// ---------------------------------------------------------------- numbering (§6.3, I3)

/** "INV-0142": the prefix and the number, zero-padded to four digits (never truncated). */
export const invoiceNumber = (prefix: string, n: number): string => `${prefix}${String(n).padStart(4, "0")}`;

export interface NumberingCandidate {
  readonly id: string;
  readonly tenancyId: string;
  readonly tenantName: string;
  readonly status: InvoiceStatus;
}

export interface Allocation {
  readonly numbers: readonly { readonly invoiceId: string; readonly number: string }[];
  readonly nextNumber: number;
}

/**
 * Give out numbers to a run's invoices at approval, in a stable order: tenant name,
 * then tenancy id (plain code-unit order, so it never depends on locale data).
 * Pure: the approval transaction writes the result.
 */
export function allocateNumbers(req: { prefix: string; nextNumber: number; invoices: readonly NumberingCandidate[] }): Allocation {
  const byName = (a: NumberingCandidate, b: NumberingCandidate): number =>
    compare(a.tenantName, b.tenantName) || compare(a.tenancyId, b.tenancyId);
  const ordered = req.invoices.filter((inv) => inv.status !== "excluded").sort(byName);
  const numbers = ordered.map((inv, i) => ({ invoiceId: inv.id, number: invoiceNumber(req.prefix, req.nextNumber + i) }));
  return { numbers, nextNumber: req.nextNumber + numbers.length };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- reminders (§3.6)

export interface ReminderCandidate {
  readonly status: InvoiceStatus;
  readonly dueDate: CalendarDate;
  readonly sentAt: Date | null;
  readonly paidAt: Date | null;
  readonly remindedAt: Date | null;
  readonly remindersPaused: boolean;
}

/**
 * Whether an invoice has earned its single reminder at `now`. One reminder, ever:
 * escalating chases are dunning, a different product. "Today" is the landlord's
 * calendar day, not the server's.
 */
export function reminderDue(req: {
  invoice: ReminderCandidate;
  org: Pick<BillingOrg, "timezone" | "reminderMode" | "reminderAfterDays">;
  now: Date;
}): boolean {
  const { invoice, org, now } = req;
  if (invoice.status !== "sent" || invoice.paidAt !== null) return false;
  if (invoice.remindersPaused) return false;
  return localDate(now, org.timezone) >= addDays(invoice.dueDate, org.reminderAfterDays);
}
