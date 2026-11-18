/**
 * Subscribers' plans and lifecycle (PLAN-SUBSCRIBERS §3-§4).
 *
 * Every date here is a calendar date in Sasimem's own day (Pacific/Port_Moresby):
 * `trialEndsOn` and `paidThrough` are the last days covered, inclusive. A status is
 * a pure function of those dates and today, so the daily tick can apply it twice.
 */
import { type Toea, toea } from "./money.js";
import { addDays, type CalendarDate, lastDay, periodOf, shiftPeriod, day } from "./period.js";

export type PlanId = "free" | "standard" | "plus";
export type Interval = "annual" | "monthly";
export type SubscriptionStatus = "trial" | "free" | "active" | "past_due" | "restricted" | "cancelled" | "purged";

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly tenancyLimit: number;
  readonly priceToeaMonthly: Toea;
  /** Ten months: two free for paying annually (D3). */
  readonly priceToeaAnnual: Toea;
  readonly public: boolean;
  readonly order: number;
}

const plan = (id: PlanId, name: string, tenancyLimit: number, monthlyKina: number, order: number): Plan => ({
  id, name, tenancyLimit, priceToeaMonthly: toea(monthlyKina * 100), priceToeaAnnual: toea(monthlyKina * 1000), public: true, order,
});

/** The plans ops/plans.ts seeds into Firestore; createOrg falls back to these if a plan is missing. */
export const DEFAULT_PLANS: readonly Plan[] = [
  plan("free", "Free", 2, 0, 0),
  plan("standard", "Standard", 10, 40, 1),
  plan("plus", "Plus", 30, 100, 2),
];

export function defaultPlan(id: PlanId): Plan {
  const found = DEFAULT_PLANS.find((p) => p.id === id);
  if (found === undefined) throw new RangeError(`no plan ${JSON.stringify(id)}`);
  return found;
}

export const priceFor = (p: Plan, interval: Interval): Toea => (interval === "annual" ? p.priceToeaAnnual : p.priceToeaMonthly);

export const TRIAL_PLAN: PlanId = "standard";
export const TRIAL_DAYS = 60;
export const GRACE_DAYS = 14;
/** Cancelled subscriptions are kept, read-only, this long before purging (D12). */
export const CANCEL_DAYS = 90;
/** Sasimem's own day: subscription dates are kept in it, whatever the landlord's timezone. */
export const SUBSCRIPTION_TIMEZONE = "Pacific/Port_Moresby";

/** The last day of a trial that starts on `today`, counting today as day one. */
export const trialEndsOn = (today: CalendarDate, days: number = TRIAL_DAYS): CalendarDate => addDays(today, days - 1);

// ---------------------------------------------------------------- the limit

export const tenancyLimit = (p: Pick<Plan, "tenancyLimit">, limitOverride: number | null): number => limitOverride ?? p.tenancyLimit;

export const canAddTenancy = (s: { readonly activeTenancyCount: number; readonly tenancyLimit: number }): boolean =>
  s.activeTenancyCount < s.tenancyLimit;

/** A tenancy counts toward the limit until its end date has passed. */
export const countsTowardLimit = (t: { readonly endDate: CalendarDate | null }, today: CalendarDate): boolean =>
  t.endDate === null || t.endDate >= today;

// ---------------------------------------------------------------- the lifecycle

/** What the status depends on. */
export interface SubscriptionTerms {
  readonly planId: PlanId;
  readonly status: SubscriptionStatus;
  readonly trialEndsOn: CalendarDate | null;
  readonly paidThrough: CalendarDate | null;
  readonly graceDays: number;
  readonly purgeAfter: CalendarDate | null;
  /** Restricted by an operator, whatever the dates say (S3). Absent on older documents: false. */
  readonly manuallyRestricted?: boolean;
}

const later = (a: CalendarDate | null, b: CalendarDate | null): CalendarDate | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

/** The last day covered by the trial or by payment, whichever is later. */
const coveredThrough = (s: SubscriptionTerms): CalendarDate | null => later(s.trialEndsOn, s.paidThrough);

/** The first day not covered, if that day has come; null while covered (or never billed). */
export function pastDueSince(s: SubscriptionTerms, today: CalendarDate): CalendarDate | null {
  const covered = coveredThrough(s);
  if (covered === null || today <= covered) return null;
  return addDays(covered, 1);
}

/**
 * The status `s` is in on `today` (PLAN-SUBSCRIBERS §4). Free, cancelled and purged
 * are set by people and change only by the calendar's purge date; the rest follow
 * from the trial and paid-through dates. Idempotent by construction.
 */
export function subscriptionStatus(s: SubscriptionTerms, today: CalendarDate): SubscriptionStatus {
  if (s.status === "purged") return "purged";
  if (s.status === "cancelled") return s.purgeAfter !== null && today >= s.purgeAfter ? "purged" : "cancelled";
  if (s.manuallyRestricted === true) return "restricted";
  // Free follows the plan, not the stored status, so lifting a hand restriction gives it back.
  if (s.planId === "free") return "free";
  if (s.trialEndsOn !== null && today <= s.trialEndsOn) return "trial";
  if (s.paidThrough !== null && today <= s.paidThrough) return "active";
  const since = pastDueSince(s, today);
  if (since === null) return "past_due"; // never covered at all: nothing to be in grace from
  return today < addDays(since, s.graceDays) ? "past_due" : "restricted";
}

/** New periods are drafted for a landlord only while their subscription allows it (D5). */
export const canDraft = (status: SubscriptionStatus): boolean =>
  status === "trial" || status === "free" || status === "active" || status === "past_due";

/** `date` plus `months`, keeping month-end at month-end and clamping a missing day. */
function addMonths(date: CalendarDate, months: number): CalendarDate {
  const target = shiftPeriod(periodOf(date), months);
  return date === lastDay(periodOf(date)) ? lastDay(target) : day(target, Number(date.slice(8, 10)));
}

/**
 * The new paid-through day after a payment for `months`. It continues from the day
 * already covered - a trial's end, or the old paid-through day while in grace, so
 * grace is not free time - except when restricted, when the landlord was not being
 * served and the new term starts today.
 */
export function extendPaidThrough(s: SubscriptionTerms, months: number, today: CalendarDate): CalendarDate {
  return paymentCovers(s, months, today).coversTo;
}

/**
 * The days a payment for `months`, arriving on `today`, pays for: from the day after
 * the last covered day (or from today when restricted for non-payment) to the new
 * paid-through day. A restriction by hand does not cost the landlord days.
 */
export function paymentCovers(s: SubscriptionTerms, months: number, today: CalendarDate): { coversFrom: CalendarDate; coversTo: CalendarDate } {
  if (!Number.isInteger(months) || months < 1) throw new RangeError(`a payment covers whole months, got ${months}`);
  const status = subscriptionStatus({ ...s, manuallyRestricted: false }, today);
  const covered = coveredThrough(s);
  const last = status === "restricted" || covered === null ? addDays(today, -1) : covered;
  return { coversFrom: addDays(last, 1), coversTo: addMonths(last, months) };
}

/** "SUB-0042": the reference a subscriber writes on their bank transfer. */
export function subscriptionReference(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`a payment reference number is a positive whole number, got ${n}`);
  return `SUB-${String(n).padStart(4, "0")}`;
}

// ---------------------------------------------------------------- documents

/** The fields of `subscriptions/{orgId}` that are not timestamps (PLAN-SUBSCRIBERS §6). */
export interface SubscriptionFields extends SubscriptionTerms {
  readonly planId: PlanId;
  readonly status: SubscriptionStatus;
  readonly interval: Interval;
  readonly priceToea: Toea;
  readonly tenancyLimit: number;
  readonly limitOverride: number | null;
  readonly trialEndsOn: CalendarDate | null;
  readonly paidThrough: CalendarDate | null;
  readonly graceDays: number;
  readonly cancelledOn: CalendarDate | null;
  readonly purgeAfter: CalendarDate | null;
  readonly paymentReference: string | null;
  readonly activeTenancyCount: number;
}

/** A sign-up's subscription: a trial (D4), priced annually by default (D3), the price locked now. */
export function newTrialSubscription(req: { plan: Plan; today: CalendarDate; referenceNumber: number; trialDays?: number }): SubscriptionFields {
  return {
    planId: req.plan.id, status: "trial", interval: "annual", priceToea: priceFor(req.plan, "annual"),
    tenancyLimit: tenancyLimit(req.plan, null), limitOverride: null,
    trialEndsOn: trialEndsOn(req.today, req.trialDays ?? TRIAL_DAYS), paidThrough: null, graceDays: GRACE_DAYS, cancelledOn: null, purgeAfter: null,
    paymentReference: subscriptionReference(req.referenceNumber), activeTenancyCount: 0,
  };
}

/** An org from before billing (D6): free for good, never limited below what it already has. */
export function newFreeSubscription(req: { plan: Plan; activeTenancyCount: number }): SubscriptionFields {
  const limitOverride = req.activeTenancyCount > req.plan.tenancyLimit ? req.activeTenancyCount : null;
  return {
    planId: req.plan.id, status: "free", interval: "annual", priceToea: toea(0),
    tenancyLimit: tenancyLimit(req.plan, limitOverride), limitOverride,
    trialEndsOn: null, paidThrough: null, graceDays: GRACE_DAYS, cancelledOn: null, purgeAfter: null,
    paymentReference: null, activeTenancyCount: req.activeTenancyCount,
  };
}

/** A plan from its Firestore document; the default when there is none. Never guesses at a malformed one. */
export function planFrom(id: PlanId, data: Record<string, unknown> | undefined): Plan {
  if (data === undefined) return defaultPlan(id);
  const whole = (k: string) => {
    const v = data[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new TypeError(`plans/${id}.${k} must be a whole number, got ${JSON.stringify(v)}`);
    return v;
  };
  return {
    id, name: typeof data["name"] === "string" ? data["name"] : defaultPlan(id).name,
    tenancyLimit: whole("tenancyLimit"), priceToeaMonthly: toea(whole("priceToeaMonthly")), priceToeaAnnual: toea(whole("priceToeaAnnual")),
    public: data["public"] !== false, order: whole("order"),
  };
}
