/**
 * The Subscribers list and Health page, as plain data (PLAN-SUBSCRIBERS §7). Pure: the
 * screens only lay these out. Statuses come from core's subscriptionStatus as of today,
 * so the list is right even before the daily subscription tick (S4) writes them.
 */
import {
  addDays, type CalendarDate, DEFAULT_PLANS, localDate, SUBSCRIPTION_TIMEZONE, type SubscriptionStatus, subscriptionStatus,
} from "@sasimem/core";
import type { SubscriberInput, TickBeat } from "./types.js";

/** An org that has not approved a run for this long, and is older than this, is worth a call. */
export const QUIET_DAYS = 62;
export const TRIAL_ENDING_DAYS = 14;
const TICK_OVERDUE_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

export interface SubscriberRow {
  readonly orgId: string;
  readonly name: string;
  readonly email: string;
  readonly plan: string;
  readonly status: SubscriptionStatus | "none";
  readonly used: number | null;
  readonly limit: number | null;
  readonly until: { readonly label: "Trial ends" | "Paid through"; readonly date: CalendarDate } | null;
  readonly reference: string | null;
  readonly lastApproval: Date | null;
  readonly held: number;
  readonly failedEmails: number;
  /** In trial, ending within TRIAL_ENDING_DAYS of today. */
  readonly trialEndingSoon: boolean;
  /** Plain words; empty when healthy. */
  readonly problems: readonly string[];
}

export const subscriptionToday = (now: Date): CalendarDate => localDate(now, SUBSCRIPTION_TIMEZONE);

const planName = (id: string): string => DEFAULT_PLANS.find((p) => p.id === id)?.name ?? id;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function lastApprovalOf(input: SubscriberInput): Date | null {
  let latest: Date | null = null;
  for (const r of input.runs) if (r.approvedAt !== null && (latest === null || r.approvedAt > latest)) latest = r.approvedAt;
  return latest;
}

function isQuiet(input: SubscriberInput, lastApproval: Date | null, now: Date): boolean {
  const cutoff = now.getTime() - QUIET_DAYS * DAY_MS;
  const established = input.org.createdAt !== null && input.org.createdAt.getTime() < cutoff;
  return established && (lastApproval === null || lastApproval.getTime() < cutoff);
}

export function subscriberRow(input: SubscriberInput, now: Date): SubscriberRow {
  const { org, sub } = input;
  const today = subscriptionToday(now);
  const held = input.runs.filter((r) => r.status === "held").length;
  const failedEmails = input.emails.filter((e) => e.status === "failed").length;
  const lastApproval = lastApprovalOf(input);

  const problems: string[] = [];
  if (sub === null) problems.push("no subscription");
  if (held > 0) problems.push(plural(held, "held run", "held runs"));
  if (failedEmails > 0) problems.push(plural(failedEmails, "email failed", "emails failed"));
  if (isQuiet(input, lastApproval, now)) problems.push("no approval in 2 months");
  if (sub !== null && sub.activeTenancyCount > sub.tenancyLimit) problems.push("over the limit");

  const status = sub === null ? "none" : subscriptionStatus(sub, today);
  const until = sub === null ? null
    : status === "trial" && sub.trialEndsOn !== null ? { label: "Trial ends" as const, date: sub.trialEndsOn }
    : sub.paidThrough !== null ? { label: "Paid through" as const, date: sub.paidThrough }
    : sub.trialEndsOn !== null ? { label: "Trial ends" as const, date: sub.trialEndsOn }
    : null;

  return {
    orgId: org.id, name: org.name, email: org.email,
    plan: sub === null ? "-" : planName(sub.planId), status,
    used: sub?.activeTenancyCount ?? null, limit: sub?.tenancyLimit ?? null,
    until, reference: sub?.paymentReference ?? null, lastApproval, held, failedEmails, problems,
    trialEndingSoon: status === "trial" && sub?.trialEndsOn != null && sub.trialEndsOn <= addDays(today, TRIAL_ENDING_DAYS),
  };
}

export type Filter = "all" | "pastDue" | "restricted" | "trialEnding" | "unhealthy";

export const FILTERS: readonly { readonly key: Filter; readonly label: string }[] = [
  { key: "all", label: "All" },
  { key: "pastDue", label: "Past due" },
  { key: "restricted", label: "Restricted" },
  { key: "trialEnding", label: `Trial ending in ${TRIAL_ENDING_DAYS} days` },
  { key: "unhealthy", label: "Needs a look" },
];

export function filterRows(rows: readonly SubscriberRow[], filter: Filter): SubscriberRow[] {
  const keep = (r: SubscriberRow): boolean => {
    switch (filter) {
      case "all": return true;
      case "pastDue": return r.status === "past_due";
      case "restricted": return r.status === "restricted";
      case "trialEnding": return r.trialEndingSoon;
      case "unhealthy": return r.problems.length > 0;
    }
  };
  return rows.filter(keep);
}

/** Every row, sorted by name. */
export function subscriberRows(inputs: readonly SubscriberInput[], now: Date): SubscriberRow[] {
  return inputs.map((i) => subscriberRow(i, now)).sort((a, b) => a.name.localeCompare(b.name));
}

export interface HealthView {
  readonly tick: { readonly lastSuccessAt: Date; readonly overdue: boolean } | null;
  readonly held: readonly { readonly orgId: string; readonly name: string; readonly period: string }[];
  readonly failedEmails: readonly { readonly orgId: string; readonly name: string; readonly to: string; readonly kind: string; readonly error: string | null; readonly sentAt: Date }[];
  readonly quiet: readonly { readonly orgId: string; readonly name: string; readonly lastApproval: Date | null }[];
}

export function healthView(inputs: readonly SubscriberInput[], tick: TickBeat | null, now: Date): HealthView {
  return {
    tick: tick === null ? null : { lastSuccessAt: tick.lastSuccessAt, overdue: now.getTime() - tick.lastSuccessAt.getTime() > TICK_OVERDUE_MS },
    held: inputs.flatMap((i) => i.runs.filter((r) => r.status === "held").map((r) => ({ orgId: i.org.id, name: i.org.name, period: r.period }))),
    failedEmails: inputs.flatMap((i) => i.emails.filter((e) => e.status === "failed")
      .map((e) => ({ orgId: i.org.id, name: i.org.name, to: e.to, kind: e.kind, error: e.error, sentAt: e.sentAt }))),
    quiet: inputs.flatMap((i) => {
      const last = lastApprovalOf(i);
      return isQuiet(i, last, now) ? [{ orgId: i.org.id, name: i.org.name, lastApproval: last }] : [];
    }),
  };
}
