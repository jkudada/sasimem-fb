import { describe, expect, test } from "vitest";
import { aTenancy } from "../testing/index.js";
import * as billing from "./billing.js";
import { parsePeriod } from "./period.js";

const OCT = parsePeriod("2026-10");

describe("which tenancies are billed in a month", () => {
  test("a tenancy that starts after the month is not billed; one starting on its last day is", () => {
    expect(billing.isActiveIn(aTenancy().starting("2026-11-01").build(), OCT)).toBe(false);
    expect(billing.isActiveIn(aTenancy().starting("2026-10-31").build(), OCT)).toBe(true);
  });
});
