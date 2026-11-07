import { describe, expect, test } from "vitest";
import { aCharge } from "../testing/index.js";
import { toea } from "./money.js";
import type { CalendarDate } from "./period.js";
import * as t from "./tenancies.js";
import type { PropertyInput, TenantInput } from "./types.js";

describe("additional charges", () => {
  const water = { ...aCharge("Water").build(), period: null };

  test("a charge needs a description of at most 100 characters", () => {
    expect(t.chargeProblems({ ...water, description: " " }).description).toBe("Say what the charge is for, such as Water.");
    expect(t.chargeProblems({ ...water, description: "x".repeat(101) }).description).toBe("Keep the description to 100 characters or fewer.");
    expect(t.chargeProblems(water)).toEqual({});
  });

  test("a charge may be a credit, but not zero and not beyond K10,000,000.00 either way", () => {
    expect(t.chargeProblems({ ...water, amountToea: toea(-2_000) }).amountToea).toBeUndefined();
    expect(t.chargeProblems({ ...water, amountToea: toea(0) }).amountToea).toBe("Enter an amount. Use a minus sign for a credit, such as -K50.00.");
    expect(t.chargeProblems({ ...water, amountToea: toea(-1_000_000_001) }).amountToea).toBe("That is more than K10,000,000.00. Check the amount.");
  });

  test("a one-off charge needs a real month; a monthly charge has none", () => {
    const once = { ...water, recurrence: "one" as const };
    expect(t.chargeProblems({ ...once, period: null }).period).toBe("Choose the month this charge is for.");
    expect(t.chargeProblems({ ...once, period: "2026-13" }).period).toBe("Choose the month this charge is for.");
    expect(t.chargeProblems({ ...once, period: "2026-10" })).toEqual({});
    expect(t.chargeProblems({ ...water, period: "2026-10" }).period).toBe("A monthly charge is not tied to one month.");
  });

  test("a tenancy has at most 10 additional charges", () => {
    expect(t.chargesProblem(Array.from({ length: 10 }, () => water))).toBeNull();
    expect(t.chargesProblem(Array.from({ length: 11 }, () => water))).toBe("A tenancy can have up to 10 additional charges.");
  });

  test("'same as the rent' says which way it falls for this property", () => {
    expect(t.sameAsRentLabel({ orgGstRegistered: true, useType: "commercial" })).toBe("Same as the rent (GST added)");
    expect(t.sameAsRentLabel({ orgGstRegistered: true, useType: "residential" })).toBe("Same as the rent (no GST)");
    expect(t.sameAsRentLabel({ orgGstRegistered: false, useType: "commercial" })).toBe("Same as the rent (no GST)");
  });
});

describe("a tenancy's copies of its tenant and property", () => {
  const property: PropertyInput = { address: "Lot 9, Gordons", useType: "commercial", units: [{ id: "u1", label: "Shop 1" }] };
  const tenant: TenantInput = { name: "Kila Trading", email: "a@kila.example", phone: "" };

  test("follow the tenant's name and the property's address, use and unit label", () => {
    expect(t.tenancyCopies({ unitId: "u1", unitLabel: "Old label" }, property, tenant)).toEqual({
      tenantName: "Kila Trading", propertyAddress: "Lot 9, Gordons", useType: "commercial", unitLabel: "Shop 1",
    });
  });

  test("keep the last unit label when the unit no longer exists", () => {
    expect(t.tenancyCopies({ unitId: "gone", unitLabel: "Shop 7" }, property, tenant).unitLabel).toBe("Shop 7");
  });
});

test("a tenancy is upcoming before it starts, current while active, and ended after its end date", () => {
  const today = "2026-10-15" as CalendarDate;
  expect(t.tenancyState({ startDate: "2026-11-01", endDate: null }, today)).toBe("upcoming");
  expect(t.tenancyState({ startDate: "2026-10-15", endDate: null }, today)).toBe("current");
  expect(t.tenancyState({ startDate: "2026-01-01", endDate: "2026-10-15" }, today)).toBe("current");
  expect(t.tenancyState({ startDate: "2026-01-01", endDate: "2026-10-14" }, today)).toBe("ended");
});

describe("what a tenancy holds in place", () => {
  const tenancies = [{ propertyId: "p1", unitId: "u1", tenantId: "t1" }];

  test("a unit with a tenancy cannot be removed from its property, though it can be renamed", () => {
    const before = { address: "Boroko", useType: "residential" as const, units: [{ id: "u1", label: "Flat 1" }, { id: "u2", label: "Flat 2" }] };
    const withoutFlat1 = { ...before, units: [{ id: "u2", label: "Flat 2" }] };
    expect(t.unitRemovalProblem("p1", before, withoutFlat1, tenancies)).toBe("Flat 1 has a tenancy, so it cannot be removed. You can rename it.");
    expect(t.unitRemovalProblem("p1", before, withoutFlat1, [])).toBeNull();
    expect(t.unitRemovalProblem("p1", before, { ...before, units: [{ id: "u1", label: "Flat 1A" }] }, tenancies)).toBeNull();
    expect(t.unitRemovalProblem("p2", before, { ...before, units: [] }, tenancies)).toBeNull();
  });

  test("a tenant or property with a tenancy cannot be deleted", () => {
    expect(t.deleteProblem({ tenantId: "t1" }, tenancies)).toBe("This has a tenancy. End or delete the tenancy first.");
    expect(t.deleteProblem({ propertyId: "p1" }, tenancies)).toBe("This has a tenancy. End or delete the tenancy first.");
    expect(t.deleteProblem({ tenantId: "t2" }, tenancies)).toBeNull();
    expect(t.deleteProblem({ propertyId: "p2" }, tenancies)).toBeNull();
  });
});
