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
