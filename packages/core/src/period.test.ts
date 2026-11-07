import { expect, test } from "vitest";
import * as period from "./period.js";

test("a period is a calendar month written YYYY-MM, read with surrounding spaces trimmed", () => {
  expect(period.parsePeriod("2026-10")).toBe("2026-10");
  expect(period.parsePeriod(" 2026-10 ")).toBe("2026-10");
});

test("anything that is not a real YYYY-MM month is rejected", () => {
  for (const bad of ["2026-13", "2026-00", "october", "2026-1", "", "2026-10-01", "26-10"]) {
    expect(() => period.parsePeriod(bad), bad).toThrow(SyntaxError);
  }
});

test("the next and previous months roll over the year", () => {
  expect(period.nextPeriod(period.parsePeriod("2026-12"))).toBe("2027-01");
  expect(period.previousPeriod(period.parsePeriod("2026-01"))).toBe("2025-12");
  expect(period.nextPeriod(period.parsePeriod("2026-09"))).toBe("2026-10");
});

test("a period runs from its first to its last calendar day, leap Februaries included", () => {
  const p = period.parsePeriod;
  expect(period.firstDay(p("2026-10"))).toBe("2026-10-01");
  expect(period.lastDay(p("2026-10"))).toBe("2026-10-31");
  expect(period.lastDay(p("2026-09"))).toBe("2026-09-30");
  expect(period.lastDay(p("2026-02"))).toBe("2026-02-28");
  expect(period.lastDay(p("2028-02"))).toBe("2028-02-29");
});

test("a billing day past the end of the month is the month's last day", () => {
  const p = period.parsePeriod;
  expect(period.day(p("2026-10"), 31)).toBe("2026-10-31");
  expect(period.day(p("2026-09"), 31)).toBe("2026-09-30");
  expect(period.day(p("2026-02"), 31)).toBe("2026-02-28");
  expect(period.day(p("2028-02"), 30)).toBe("2028-02-29");
  expect(period.day(p("2026-10"), 1)).toBe("2026-10-01");
});

test("a period reads as October 2026 and abbreviates to OCT26 for payment references", () => {
  const p = period.parsePeriod;
  expect(period.periodLabel(p("2026-10"))).toBe("October 2026");
  expect(period.periodLabel(p("2027-01"))).toBe("January 2027");
  expect(period.shortCode(p("2026-10"))).toBe("OCT26");
  expect(period.shortCode(p("2030-05"))).toBe("MAY30");
  expect(period.shortCode(p("2009-12"))).toBe("DEC09");
});

test("adding days to a calendar date crosses month and year ends", () => {
  const d = (s: string) => s as period.CalendarDate;
  expect(period.addDays(d("2026-10-01"), 7)).toBe("2026-10-08");
  expect(period.addDays(d("2026-10-25"), 14)).toBe("2026-11-08");
  expect(period.addDays(d("2026-12-31"), 1)).toBe("2027-01-01");
  expect(period.addDays(d("2028-02-28"), 1)).toBe("2028-02-29");
  expect(period.addDays(d("2026-03-01"), -1)).toBe("2026-02-28");
});

test("today is the landlord's calendar day in their timezone, not the server's", () => {
  // 14:00 UTC on 30 September is already midnight, 1 October, in Port Moresby (UTC+10).
  const now = new Date("2026-09-30T14:00:00Z");
  expect(period.localDate(now, "Pacific/Port_Moresby")).toBe("2026-10-01");
  expect(period.localDate(new Date("2026-09-30T13:59:59Z"), "Pacific/Port_Moresby")).toBe("2026-09-30");
  expect(period.localDate(now, "UTC")).toBe("2026-09-30");
});

test("08:00 on a landlord's date in Port Moresby is 22:00 UTC the day before", () => {
  const sendAt = period.zonedInstant("2026-10-01" as period.CalendarDate, 8, "Pacific/Port_Moresby");
  expect(sendAt.toISOString()).toBe("2026-09-30T22:00:00.000Z");
  expect(period.zonedInstant("2026-10-01" as period.CalendarDate, 8, "UTC").toISOString()).toBe("2026-10-01T08:00:00.000Z");
});

test("a calendar date falls in the period of its year and month", () => {
  expect(period.periodOf("2026-10-31" as period.CalendarDate)).toBe("2026-10");
  expect(period.periodOf("2027-01-01" as period.CalendarDate)).toBe("2027-01");
});
