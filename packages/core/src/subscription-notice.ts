/**
 * What a landlord is told about their subscription (PLAN-SUBSCRIBERS §8, S4): the
 * banner for each status, why a new month cannot be drafted, and the tenancy limit.
 * Pure words from the subscription, today and Sasimem's bank details, so the app,
 * the callables and the tests all say the same thing.
 */
import { formatKina, type Toea, toea } from "./money.js";
import { addDays, type CalendarDate, dateLabel } from "./period.js";
import { defaultPlan, type SubscriptionFields, type SubscriptionStatus, subscriptionStatus, pastDueSince } from "./subscriptions.js";

/** A trial's banner shows from two weeks before its last day, when the first reminder email goes (S5). */
export const TRIAL_WARNING_DAYS = 14;

/** Where subscribers pay (`sasimem/billing`, seeded by ops/billing-details.ts). */
export interface BankDetails {
  readonly accountName: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly branch?: string | null;
  /** Where "Ask to change plan" goes, and who a restricted landlord contacts. */
  readonly contactEmail?: string | null;
}

export interface SubscriptionNotice {
  readonly kind: "trialEnding" | "pastDue" | "restricted" | "cancelled";
  /** A warning can wait a little; a problem is stopping something now. */
  readonly tone: "warning" | "problem";
  readonly title: string;
  readonly body: string;
}

/** What one payment is: a year when annual, three months in advance when monthly (D3). */
export function amountDue(s: Pick<SubscriptionFields, "interval" | "priceToea">): { amountToea: Toea; covers: string; months: number } {
  return s.interval === "annual"
    ? { amountToea: s.priceToea, covers: "a year", months: 12 }
    : { amountToea: toea(s.priceToea * 3), covers: "three months", months: 3 };
}

const DAY_MS = 86_400_000;
const daysFrom = (a: CalendarDate, b: CalendarDate): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** How to pay, in one sentence: the amount, the bank and the reference. */
export function howToPay(s: Pick<SubscriptionFields, "interval" | "priceToea" | "paymentReference">, bank: BankDetails | null): string {
  const { amountToea, covers } = amountDue(s);
  const ref = s.paymentReference === null ? "" : `, with the reference ${s.paymentReference}`;
  const to = bank === null
    ? ""
    : ` to ${bank.accountName}, ${bank.bankName} account ${bank.accountNumber}${typeof bank.branch === "string" && bank.branch !== "" ? ` (${bank.branch})` : ""}`;
  const ask = bank === null ? " Ask Sasimem for the bank details." : "";
  return `Pay ${formatKina(amountToea)} for ${covers}${to}${ref}.${ask}`;
}

const contact = (bank: BankDetails | null): string =>
  typeof bank?.contactEmail === "string" && bank.contactEmail !== "" ? `Contact Sasimem at ${bank.contactEmail}.` : "Contact Sasimem.";

const ALREADY_APPROVED = "Invoices already approved are sent as normal.";

/** The banner for `s` on `today`, or null when there is nothing to say. Follows the status the dates give, not the stored one. */
export function subscriptionNotice(s: SubscriptionFields, today: CalendarDate, bank: BankDetails | null): SubscriptionNotice | null {
  const status = subscriptionStatus(s, today);
  const plan = defaultPlan(s.planId).name;
  switch (status) {
    case "trial": {
      if (s.trialEndsOn === null) return null;
      const left = daysFrom(today, s.trialEndsOn);
      if (left > TRIAL_WARNING_DAYS) return null;
      const when = left === 0 ? "today" : left === 1 ? "tomorrow" : `on ${dateLabel(s.trialEndsOn)}`;
      return {
        kind: "trialEnding", tone: "warning", title: `Your free trial ends ${when}`,
        body: `To keep invoicing on ${plan} after it ends: ${howToPay(s, bank)}`,
      };
    }
    case "past_due": {
      const since = pastDueSince(s, today);
      const restrictedFrom = since === null ? null : addDays(since, s.graceDays);
      const by = restrictedFrom === null ? "" : ` From ${dateLabel(restrictedFrom)}, next month's invoices will not be drafted until payment arrives.`;
      return {
        kind: "pastDue", tone: "warning", title: "Your Sasimem payment is overdue",
        body: `${howToPay(s, bank)}${by} ${ALREADY_APPROVED}`,
      };
    }
    case "restricted":
      return s.manuallyRestricted === true
        ? {
          kind: "restricted", tone: "problem", title: "Your Sasimem subscription is restricted",
          body: `Next month's invoices will not be drafted until Sasimem lifts the restriction. ${ALREADY_APPROVED} ${contact(bank)}`,
        }
        : {
          kind: "restricted", tone: "problem", title: "Your Sasimem subscription is restricted",
          body: `Next month's invoices will not be drafted until payment arrives. ${ALREADY_APPROVED} ${howToPay(s, bank)}`,
        };
    case "cancelled":
      return {
        kind: "cancelled", tone: "problem", title: "Your Sasimem subscription is cancelled",
        body: `No new month will be drafted.${s.purgeAfter === null ? "" : ` Your records are kept, read-only, until ${dateLabel(s.purgeAfter)}.`} ${contact(bank)}`,
      };
    default:
      return null;
  }
}

/** Why a new month cannot be drafted (the tick skips it; draftNow says this), or null when it can. */
export function draftRefusal(s: Pick<SubscriptionFields, "manuallyRestricted">, status: SubscriptionStatus): string | null {
  switch (status) {
    case "restricted":
      return s.manuallyRestricted === true
        ? "Your Sasimem subscription is restricted, so no new month can be drafted until Sasimem lifts the restriction. Months already drafted carry on as normal."
        : "Your Sasimem subscription is restricted, so no new month can be drafted until payment arrives. Months already drafted carry on as normal. See Settings, Plan & billing.";
    case "cancelled":
    case "purged":
      return "Your Sasimem subscription is cancelled, so no new month can be drafted.";
    default:
      return null;
  }
}

/** "7 of 10 tenancies". */
export const usageText = (s: Pick<SubscriptionFields, "activeTenancyCount" | "tenancyLimit">): string =>
  `${s.activeTenancyCount} of ${s.tenancyLimit} ${s.tenancyLimit === 1 ? "tenancy" : "tenancies"}`;

/** Why another tenancy cannot be added, said before the landlord fills in the form. */
export const limitText = (s: Pick<SubscriptionFields, "activeTenancyCount" | "tenancyLimit" | "planId">): string =>
  `On ${defaultPlan(s.planId).name} you can have ${s.tenancyLimit} ${s.tenancyLimit === 1 ? "tenancy" : "tenancies"} at once, and you have ${s.activeTenancyCount}. ` +
  "To add another, end a tenancy that has finished, or ask to change plan.";

/** A status in the landlord's words. */
export const STATUS_LABELS: Readonly<Record<SubscriptionStatus, string>> = {
  trial: "Free trial", free: "Free", active: "Active", past_due: "Payment overdue",
  restricted: "Restricted", cancelled: "Cancelled", purged: "Closed",
};
