/**
 * Periods and calendar dates (plan §3.3).
 *
 * A period is a calendar month, the string "YYYY-MM" - part of every idempotency
 * key. A CalendarDate is a landlord's date, "YYYY-MM-DD", not an instant.
 * Calendar arithmetic is done on UTC dates, which have no offsets to get wrong;
 * anything involving a timezone goes through date-fns-tz.
 */

export type Period = string & { readonly __brand: "Period" };
export type CalendarDate = string & { readonly __brand: "CalendarDate" };

export function parsePeriod(text: string): Period {
  return text.trim() as Period;
}
