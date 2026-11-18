/**
 * What an operator can do to a subscription (PLAN-SUBSCRIBERS §7, S3), as pure
 * functions: the console builds an action, the `operatorAction` callable reads it with
 * `operatorActionFrom`, applies it with `applyOperatorAction` and stores the result
 * with an audit entry made from `subscriptionDiff`. Functions only load, call and store.
 */
import { amountProblem, formatKina, toea } from "./money.js";
import { addDays, type CalendarDate, parseCalendarDate } from "./period.js";
import {
  CANCEL_DAYS, type Interval, type Plan, type PlanId, paymentCovers, priceFor, type SubscriptionFields,
  subscriptionReference, subscriptionStatus, tenancyLimit,
} from "./subscriptions.js";

export type OperatorAction =
  | { readonly kind: "recordPayment"; readonly amountToea: number; readonly receivedOn: CalendarDate; readonly bankReference: string; readonly months: number }
  | { readonly kind: "changePlan"; readonly planId: PlanId; readonly interval: Interval }
  | { readonly kind: "extendTrial"; readonly days: number }
  | { readonly kind: "setLimitOverride"; readonly limit: number | null }
  | { readonly kind: "restrict" }
  | { readonly kind: "unrestrict" }
  | { readonly kind: "cancelSubscription" }
  | { readonly kind: "reinstate" }
  | { readonly kind: "addNote"; readonly text: string };

export type OperatorActionKind = OperatorAction["kind"];

export const ACTION_KINDS: readonly OperatorActionKind[] = [
  "recordPayment", "changePlan", "extendTrial", "setLimitOverride", "restrict", "unrestrict", "cancelSubscription", "reinstate", "addNote",
];

export const MAX_PAYMENT_MONTHS = 36;
export const MAX_TRIAL_EXTENSION_DAYS = 365;
export const MAX_LIMIT_OVERRIDE = 1000;
export const MAX_NOTE = 2000;
export const MAX_BANK_REFERENCE = 60;

const PLAN_IDS: readonly PlanId[] = ["free", "standard", "plus"];
const UNREADABLE = "That action could not be read. Reload the page and try again.";

const wholeIn = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const text = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);

/** Read an action from untrusted data; a plain-English problem if it is not one. */
export function operatorActionFrom(data: unknown): OperatorAction | { readonly problem: string } {
  if (typeof data !== "object" || data === null) return { problem: UNREADABLE };
  const o = data as Record<string, unknown>;
  switch (o["kind"]) {
    case "recordPayment": {
      const amount = o["amountToea"];
      if (!wholeIn(amount, 1, Number.MAX_SAFE_INTEGER)) return { problem: `The amount must be more than ${formatKina(toea(0))}.` };
      const tooBig = amountProblem(toea(amount));
      if (tooBig !== null) return { problem: tooBig };
      let receivedOn: CalendarDate;
      try {
        receivedOn = parseCalendarDate(String(o["receivedOn"] ?? ""));
      } catch {
        return { problem: "Enter the day the money arrived." };
      }
      const bankReference = text(o["bankReference"]);
      if (bankReference === null || bankReference === "") return { problem: "Enter the bank's reference for the transfer." };
      if (bankReference.length > MAX_BANK_REFERENCE) return { problem: `A bank reference is at most ${MAX_BANK_REFERENCE} characters.` };
      if (!wholeIn(o["months"], 1, MAX_PAYMENT_MONTHS)) return { problem: `A payment covers 1 to ${MAX_PAYMENT_MONTHS} whole months.` };
      return { kind: "recordPayment", amountToea: amount, receivedOn, bankReference, months: o["months"] as number };
    }
    case "changePlan": {
      const planId = o["planId"];
      if (!PLAN_IDS.includes(planId as PlanId)) return { problem: "Choose Free, Standard or Plus." };
      const interval = o["interval"];
      if (interval !== "annual" && interval !== "monthly") return { problem: "Choose annual or monthly billing." };
      return { kind: "changePlan", planId: planId as PlanId, interval };
    }
    case "extendTrial":
      if (!wholeIn(o["days"], 1, MAX_TRIAL_EXTENSION_DAYS)) return { problem: `Extend a trial by 1 to ${MAX_TRIAL_EXTENSION_DAYS} days.` };
      return { kind: "extendTrial", days: o["days"] as number };
    case "setLimitOverride": {
      const limit = o["limit"];
      if (limit !== null && !wholeIn(limit, 1, MAX_LIMIT_OVERRIDE)) {
        return { problem: `A limit is a whole number from 1 to ${MAX_LIMIT_OVERRIDE}, or blank for the plan's.` };
      }
      return { kind: "setLimitOverride", limit: limit as number | null };
    }
    case "restrict": case "unrestrict": case "cancelSubscription": case "reinstate":
      return { kind: o["kind"] };
    case "addNote": {
      const note = text(o["text"]);
      if (note === null || note === "") return { problem: "Write the note first." };
      if (note.length > MAX_NOTE) return { problem: `A note is at most ${MAX_NOTE} characters.` };
      return { kind: "addNote", text: note };
    }
    default:
      return { problem: UNREADABLE };
  }
}

/** What an action needs beyond the subscription. */
export interface ActionContext {
  /** Sasimem's day (Port Moresby). */
  readonly today: CalendarDate;
  /** The plan asked for by `changePlan`; otherwise the subscription's own plan. */
  readonly plan: Plan;
  /** The next `SUB-` number, used only when a free subscription moves to a paid plan. */
  readonly referenceNumber: number;
}

export type ActionResult =
  | {
    readonly ok: true;
    readonly sub: SubscriptionFields;
    /** recordPayment: the days it pays for. */
    readonly payment?: { readonly coversFrom: CalendarDate; readonly coversTo: CalendarDate };
    /** addNote: the note's text. */
    readonly note?: string;
    /** True when `referenceNumber` was given out, so the counter moves on. */
    readonly usedReference: boolean;
  }
  | { readonly ok: false; readonly problem: string };

const refuse = (problem: string): ActionResult => ({ ok: false, problem });

/** The subscription with its status as of `today`: every change is followed by this. */
const settled = (s: SubscriptionFields, today: CalendarDate): SubscriptionFields => ({ ...s, status: subscriptionStatus(s, today) });

/**
 * Apply `action` to `sub`. Refuses, in plain words, anything not allowed in the
 * subscription's status, and anything that would change nothing, so the audit trail
 * holds only real changes.
 */
export function applyOperatorAction(sub: SubscriptionFields, action: OperatorAction, ctx: ActionContext): ActionResult {
  const { today } = ctx;
  if (action.kind === "changePlan" ? ctx.plan.id !== action.planId : ctx.plan.id !== sub.planId) {
    throw new RangeError(`the context's plan ${ctx.plan.id} is not the one this action needs`);
  }
  const now = subscriptionStatus(sub, today);
  if (now === "purged") return refuse("This subscription has been purged.");
  if (now === "cancelled" && action.kind === "cancelSubscription") return refuse("Already cancelled.");
  if (now === "cancelled" && action.kind !== "reinstate" && action.kind !== "addNote") return refuse("Reinstate the subscription first.");

  let next: SubscriptionFields;
  let payment: { coversFrom: CalendarDate; coversTo: CalendarDate } | undefined;
  let usedReference = false;
  switch (action.kind) {
    case "addNote":
      return { ok: true, sub, note: action.text, usedReference };

    case "recordPayment": {
      if (sub.planId === "free") return refuse("A free subscription is not paid for. Change its plan first.");
      if (action.receivedOn > today) return refuse("The money cannot have arrived after today.");
      payment = paymentCovers(sub, action.months, action.receivedOn);
      next = { ...sub, paidThrough: payment.coversTo };
      break;
    }

    case "changePlan": {
      if (action.planId === sub.planId && action.interval === sub.interval) return refuse("Nothing to change.");
      const toFree = action.planId === "free";
      const needsReference = !toFree && sub.paymentReference === null;
      usedReference = needsReference;
      next = {
        ...sub, planId: action.planId, interval: action.interval,
        priceToea: toFree ? toea(0) : priceFor(ctx.plan, action.interval),
        tenancyLimit: tenancyLimit(ctx.plan, sub.limitOverride),
        paymentReference: needsReference ? subscriptionReference(ctx.referenceNumber) : sub.paymentReference,
      };
      break;
    }

    case "extendTrial": {
      if (sub.planId === "free") return refuse("A free subscription has no trial.");
      const yesterday = addDays(today, -1);
      const from = sub.trialEndsOn !== null && sub.trialEndsOn > yesterday ? sub.trialEndsOn : yesterday;
      next = { ...sub, trialEndsOn: addDays(from, action.days) };
      break;
    }

    case "setLimitOverride":
      if (action.limit === sub.limitOverride) return refuse("Nothing to change.");
      next = { ...sub, limitOverride: action.limit, tenancyLimit: tenancyLimit(ctx.plan, action.limit) };
      break;

    case "restrict":
      if (sub.manuallyRestricted === true) return refuse("Already restricted by hand.");
      next = { ...sub, manuallyRestricted: true };
      break;

    case "unrestrict":
      if (sub.manuallyRestricted !== true) {
        return refuse(now === "restricted"
          ? "This is restricted because it is unpaid, not by hand. Record a payment or extend the trial."
          : "This is not restricted.");
      }
      next = { ...sub, manuallyRestricted: false };
      break;

    case "cancelSubscription":
      return { ok: true, sub: { ...sub, status: "cancelled", cancelledOn: today, purgeAfter: addDays(today, CANCEL_DAYS) }, usedReference };

    case "reinstate":
      if (now !== "cancelled") return refuse("Only a cancelled subscription can be reinstated.");
      // The status the plan and dates give back (settled): free stays free, the rest follow trial and payment.
      next = { ...sub, status: "active", cancelledOn: null, purgeAfter: null };
      break;
  }
  return { ok: true, sub: settled(next, today), ...(payment === undefined ? {} : { payment }), usedReference };
}

/** The fields that changed, before and after, for the audit trail. */
export function subscriptionDiff(before: SubscriptionFields, after: SubscriptionFields): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof SubscriptionFields>;
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    const was = before[k] ?? null;
    const is = after[k] ?? null;
    if (was !== is && !(k === "manuallyRestricted" && (was ?? false) === (is ?? false))) {
      b[k] = was;
      a[k] = is;
    }
  }
  return { before: b, after: a };
}
