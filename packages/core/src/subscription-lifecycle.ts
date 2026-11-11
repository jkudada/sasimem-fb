/**
 * Which lifecycle emails a subscriber is due (PLAN-SUBSCRIBERS §9, S5). Pure: the daily
 * subscription tick asks this for every subscription, and each answer has a key that
 * names one trigger, so the email is claimed once (`notices/{key}`, written with create())
 * and a later day asking again finds it already sent.
 */
import type { CalendarDate } from "./period.js";
import { type SubscriptionFields, pastDueSince, subscriptionStatus } from "./subscriptions.js";

export type LifecycleKind = "welcome" | "setupNudge" | "trialEnding" | "pastDue" | "restricted";

export interface LifecycleNotice {
  readonly kind: LifecycleKind;
  /** The notice's document ID: one per trigger. */
  readonly key: string;
}

/** A welcome is sent within this many days of sign-up and never later, so a deploy emails no old org. */
export const WELCOME_WITHIN_DAYS = 2;
/** The setup nudge, once, this many days after sign-up if there is still no tenancy... */
export const NUDGE_AFTER_DAYS = 3;
/** ...and not after this many, for the same reason as the welcome. */
export const NUDGE_UNTIL_DAYS = 10;
/** Trial reminders: two weeks and three days before the last day. */
export const TRIAL_REMINDER_DAYS = [14, 3] as const;

export interface LifecycleFacts {
  readonly sub: SubscriptionFields;
  /** The day the org was created, Port Moresby time. */
  readonly createdOn: CalendarDate;
  readonly hasTenancy: boolean;
}

const DAY_MS = 86_400_000;
const daysFrom = (a: CalendarDate, b: CalendarDate): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** The notices due today. Sending one that was already claimed is the caller's to prevent. */
export function lifecycleNoticesDue(f: LifecycleFacts, today: CalendarDate): LifecycleNotice[] {
  const due: LifecycleNotice[] = [];
  const age = daysFrom(f.createdOn, today);
  if (age >= 0 && age <= WELCOME_WITHIN_DAYS) due.push({ kind: "welcome", key: "welcome" });
  if (!f.hasTenancy && age >= NUDGE_AFTER_DAYS && age <= NUDGE_UNTIL_DAYS) due.push({ kind: "setupNudge", key: "setupNudge" });

  const status = subscriptionStatus(f.sub, today);
  if (status === "trial" && f.sub.trialEndsOn !== null) {
    const left = daysFrom(today, f.sub.trialEndsOn);
    // The nearest reminder whose day has come; a short trial skips straight to it.
    const days = TRIAL_REMINDER_DAYS.filter((d) => left <= d).at(-1);
    // Keyed by the end date too, so an extended trial is reminded again.
    if (days !== undefined) due.push({ kind: "trialEnding", key: `trialEnding${days}_${f.sub.trialEndsOn}` });
  }
  const since = pastDueSince(f.sub, today);
  // Keyed by the first unpaid day: each lapse is told once, and a later one again.
  if (status === "past_due") due.push({ kind: "pastDue", key: `pastDue_${since ?? "never"}` });
  // A hand restriction is the operator's to explain; this is for non-payment.
  if (status === "restricted" && f.sub.manuallyRestricted !== true) due.push({ kind: "restricted", key: `restricted_${since ?? "never"}` });
  return due;
}

/** What a subscription brings in a year at its locked price: annual as is, monthly times 12. */
export const annualisedToea = (s: Pick<SubscriptionFields, "interval" | "priceToea">): number =>
  s.interval === "annual" ? s.priceToea : s.priceToea * 12;

/** The day a trial or paid term will need renewing: the last day covered. */
export const renewalDue = (s: Pick<SubscriptionFields, "paidThrough" | "trialEndsOn">): CalendarDate | null => s.paidThrough ?? s.trialEndsOn;
