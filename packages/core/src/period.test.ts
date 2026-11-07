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
