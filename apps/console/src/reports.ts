/**
 * The Metrics and Billing pages, as plain data (PLAN-SUBSCRIBERS §7, S5). Pure, like
 * rows.ts: statuses come from core's subscriptionStatus as of today, money is toea.
 */
import {
  addDays, annualisedToea, type CalendarDate, csvDecimal, csvText, type PlanId, periodOf, type Period, shiftPeriod, type SubscriptionStatus, subscriptionStatus,
} from "@sasimem/core";
import { subscriptionToday } from "./rows.js";
import type { PaymentRow, SubscriberInput } from "./types.js";

export const RENEWAL_WINDOW_DAYS = 30;
const MONTHS_SHOWN = 12;

/** The last twelve months, oldest first, ending with this one. */
const lastMonths = (today: CalendarDate): Period[] =>
  Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftPeriod(periodOf(today), i - MONTHS_SHOWN + 1));

export interface MetricsView {
  /** Subscribers by plan, then by status. */
  readonly byPlan: Readonly<Record<PlanId, Readonly<Partial<Record<SubscriptionStatus, number>>>>>;
  /** Active and past-due subscriptions at their locked price, a year's worth; trials and free count nothing. */
  readonly annualRevenueToea: number;
  /** Trials that have ended, and how many of those paid. */
  readonly trials: { readonly ended: number; readonly paid: number };
  readonly months: readonly { readonly period: Period; readonly cancelled: number; readonly invoicesSent: number }[];
}

export function metricsView(inputs: readonly SubscriberInput[], now: Date): MetricsView {
  const today = subscriptionToday(now);
  const byPlan: Record<PlanId, Partial<Record<SubscriptionStatus, number>>> = { free: {}, standard: {}, plus: {} };
  let annualRevenueToea = 0;
  let ended = 0;
  let paid = 0;
  const months = lastMonths(today).map((period) => ({ period, cancelled: 0, invoicesSent: 0 }));
  const month = (p: string) => months.find((m) => m.period === p);

  for (const { sub, runs } of inputs) {
    for (const r of runs) {
      const m = month(r.period);
      if (m !== undefined && r.status === "sent") m.invoicesSent += r.invoiceCount;
    }
    if (sub === null) continue;
    const status = subscriptionStatus(sub, today);
    const counts = byPlan[sub.planId];
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === "active" || status === "past_due") annualRevenueToea += annualisedToea(sub);
    if (sub.trialEndsOn !== null && sub.trialEndsOn < today) {
      ended++;
      if (sub.paidThrough !== null) paid++;
    }
    if (sub.cancelledOn !== null) {
      const m = month(periodOf(sub.cancelledOn));
      if (m !== undefined) m.cancelled++;
    }
  }
  return { byPlan, annualRevenueToea, trials: { ended, paid }, months };
}

export interface BillingLine {
  readonly orgId: string;
  readonly name: string;
  readonly date: CalendarDate;
  readonly amountToea: number;
  readonly reference: string | null;
}

export interface BillingView {
  /** Paid subscriptions whose term ends within 30 days, soonest first. */
  readonly renewals: readonly BillingLine[];
  /** Past due or restricted for non-payment, the longest unpaid first; `date` is the last day covered. */
  readonly overdue: readonly (BillingLine & { readonly status: SubscriptionStatus })[];
  readonly paymentsThisMonth: readonly PaymentRow[];
  readonly receivedThisMonthToea: number;
}

export function billingView(inputs: readonly SubscriberInput[], payments: readonly PaymentRow[], now: Date): BillingView {
  const today = subscriptionToday(now);
  const horizon = addDays(today, RENEWAL_WINDOW_DAYS);
  const renewals: BillingLine[] = [];
  const overdue: (BillingLine & { status: SubscriptionStatus })[] = [];
  for (const { org, sub } of inputs) {
    if (sub === null) continue;
    const status = subscriptionStatus(sub, today);
    const line = (date: CalendarDate): BillingLine => ({ orgId: org.id, name: org.name, date, amountToea: sub.priceToea, reference: sub.paymentReference });
    if (status === "active" && sub.paidThrough !== null && sub.paidThrough <= horizon) renewals.push(line(sub.paidThrough));
    const covered = sub.paidThrough ?? sub.trialEndsOn;
    if ((status === "past_due" || (status === "restricted" && sub.manuallyRestricted !== true)) && covered !== null) overdue.push({ ...line(covered), status });
  }
  const thisMonth = periodOf(today);
  const paymentsThisMonth = payments.filter((p) => periodOf(p.receivedOn) === thisMonth).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
  return {
    renewals: renewals.sort((a, b) => a.date.localeCompare(b.date)),
    overdue: overdue.sort((a, b) => a.date.localeCompare(b.date)),
    paymentsThisMonth,
    receivedThisMonthToea: paymentsThisMonth.reduce((t, p) => t + p.amountToea, 0),
  };
}


/** Payments received in [from, to] (months), oldest first, to set beside the bank statement. */
export function paymentsCsv(payments: readonly PaymentRow[], from: Period, to: Period): string {
  const rows = payments
    .filter((p) => periodOf(p.receivedOn) >= from && periodOf(p.receivedOn) <= to)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.orgName.localeCompare(b.orgName));
  const header = ["Received on", "Organisation", "Amount (K)", "Bank reference", "Subscription reference", "Covers from", "Covers to"];
  const lines = rows.map((p) => [
    p.receivedOn, csvText(p.orgName), csvDecimal(p.amountToea), csvText(p.bankReference), csvText(p.subscriptionReference ?? ""), p.coversFrom ?? "", p.coversTo ?? "",
  ].join(","));
  return [header.join(","), ...lines, ""].join("\r\n");
}
