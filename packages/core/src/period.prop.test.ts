import fc from "fast-check";
import { expect, test } from "vitest";
import { type Period, nextPeriod, parsePeriod, previousPeriod, shiftPeriod } from "./period.js";

const aPeriod = fc
  .record({ year: fc.integer({ min: 2000, max: 2200 }), month: fc.integer({ min: 1, max: 12 }) })
  .map(({ year, month }) => parsePeriod(`${year}-${String(month).padStart(2, "0")}`));
const months = fc.integer({ min: -600, max: 600 });

test("next and previous undo each other, and shifts compose", () => {
  fc.assert(fc.property(aPeriod, months, months, (p: Period, a, b) => {
    expect(nextPeriod(previousPeriod(p))).toBe(p);
    expect(shiftPeriod(shiftPeriod(p, a), b)).toBe(shiftPeriod(p, a + b));
    expect(parsePeriod(shiftPeriod(p, a))).toBe(shiftPeriod(p, a)); // always a valid period
  }));
});
