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
  const trimmed = text.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  const month = Number(match?.[2]);
  if (match === null || month < 1 || month > 12) {
    throw new SyntaxError(`expected a period like "2026-10", got ${JSON.stringify(text)}`);
  }
  return trimmed as Period;
}

function parts(p: Period): { year: number; month: number } {
  return { year: Number(p.slice(0, 4)), month: Number(p.slice(5, 7)) };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** The period `months` away from `p` (negative goes back). */
export function shiftPeriod(p: Period, months: number): Period {
  const { year, month } = parts(p);
  const index = year * 12 + (month - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1, 2)}` as Period;
}

export const nextPeriod = (p: Period): Period => shiftPeriod(p, 1);
export const previousPeriod = (p: Period): Period => shiftPeriod(p, -1);

function daysInMonth(p: Period): number {
  const { year, month } = parts(p);
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of the next month
}

export const firstDay = (p: Period): CalendarDate => `${p}-01` as CalendarDate;
export const lastDay = (p: Period): CalendarDate => `${p}-${pad(daysInMonth(p), 2)}` as CalendarDate;

/** Day `n` of the period, clamped: the 31st in a 30-day month is the 30th. */
export function day(p: Period, n: number): CalendarDate {
  return `${p}-${pad(Math.min(n, daysInMonth(p)), 2)}` as CalendarDate;
}

// English month names, written out rather than taken from Intl, so the label
// never depends on the device's locale data.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"] as const;

function monthName(p: Period): string {
  return MONTHS[parts(p).month - 1] ?? "";
}

/** "October 2026", for email subjects and line details. */
export const periodLabel = (p: Period): string => `${monthName(p)} ${parts(p).year}`;

/** "OCT26", the month part of a payment reference such as WARI-OCT26. */
export const shortCode = (p: Period): string =>
  `${monthName(p).slice(0, 3).toUpperCase()}${pad(parts(p).year % 100, 2)}`;
