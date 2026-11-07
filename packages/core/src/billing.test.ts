import { describe, expect, test } from "vitest";
import { aCharge, aTenancy } from "../testing/index.js";
import * as billing from "./billing.js";
import { parsePeriod } from "./period.js";

const OCT = parsePeriod("2026-10");

describe("which tenancies are billed in a month", () => {
  test("a tenancy that starts after the month is not billed; one starting on its last day is", () => {
    expect(billing.isActiveIn(aTenancy().starting("2026-11-01").build(), OCT)).toBe(false);
    expect(billing.isActiveIn(aTenancy().starting("2026-10-31").build(), OCT)).toBe(true);
  });
});

describe("tenancies that end", () => {
  test("a tenancy that ended before the month is not billed", () => {
    expect(billing.isActiveIn(aTenancy().ending("2026-09-30").build(), OCT)).toBe(false);
  });

  test("a tenancy ending mid-month, or on its first day, is still billed for that month", () => {
    expect(billing.isActiveIn(aTenancy().ending("2026-10-15").build(), OCT)).toBe(true);
    expect(billing.isActiveIn(aTenancy().ending("2026-10-01").build(), OCT)).toBe(true);
  });
});

describe("which additional charges apply", () => {
  test("a recurring charge applies every month", () => {
    expect(billing.chargeApplies(aCharge().every().build(), OCT)).toBe(true);
  });
});

test("a charge the landlord switched off never applies", () => {
  expect(billing.chargeApplies(aCharge().every().inactive().build(), OCT)).toBe(false);
});

test("a one-month charge applies only in the month it names", () => {
  const repair = aCharge("Repair").onlyIn("2026-10").build();
  expect(billing.chargeApplies(repair, OCT)).toBe(true);
  expect(billing.chargeApplies(repair, parsePeriod("2026-11"))).toBe(false);
});

test("the payment reference is the tenancy's code, upper-cased, then the month: WARI-OCT26", () => {
  expect(billing.paymentReference(aTenancy().reference("wari").build(), OCT)).toBe("WARI-OCT26");
});
