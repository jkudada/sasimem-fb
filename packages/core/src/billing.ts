/**
 * Billing rules (plan §3.4-§3.6): drafting, scheduling, the state machine and
 * reminders. Pure functions over plain data; every time-dependent rule takes `now`.
 */
import { firstDay, lastDay, type Period } from "./period.js";
import type { Charge, Tenancy } from "./types.js";

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
