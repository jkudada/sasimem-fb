/** How the console writes things: kina, PNG dates, plain status words. */
import { type CalendarDate, dateLabel, formatKina, localDate, SUBSCRIPTION_TIMEZONE, type SubscriptionStatus, toea } from "@sasimem/core";

export const kina = (amount: number): string => formatKina(toea(amount));
export const day = (date: CalendarDate): string => dateLabel(date);
/** An instant as the calendar day it was in Port Moresby. */
export const when = (at: Date | null): string => (at === null ? "never" : dateLabel(localDate(at, SUBSCRIPTION_TIMEZONE)));

export const STATUS_WORDS: Record<SubscriptionStatus | "none", string> = {
  trial: "Trial", free: "Free", active: "Active", past_due: "Past due", restricted: "Restricted",
  cancelled: "Cancelled", purged: "Purged", none: "No subscription",
};
