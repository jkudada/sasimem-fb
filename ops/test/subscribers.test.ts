import { DEFAULT_PLANS, defaultPlan, newFreeSubscription, STAFF_ROLES, type CalendarDate } from "@sasimem/core";
import { describe, expect, test } from "vitest";
import * as s from "../src/subscribers.ts";

const now = new Date("2026-11-08T20:00:00Z"); // 9 November, 6 am in Port Moresby
const P = "projects/sasimem-dev/databases/(default)/documents";

describe("the ops copy of the plans matches core's (ops scripts cannot import core)", () => {
  test("same plans, limits and prices", () => {
    expect(s.OPS_PLANS).toEqual(DEFAULT_PLANS.map(({ id, ...rest }) => ({ id, ...rest })));
  });

  test("the same free subscription core would build, for any count", () => {
    for (const count of [0, 1, 2, 3, 7]) {
      expect(s.freeSubscription(count)).toEqual(newFreeSubscription({ plan: defaultPlan("free"), activeTenancyCount: count }));
    }
  });
});

describe("Firestore REST values", () => {
  test("strings, whole numbers, booleans, null and instants", () => {
    expect(s.encodeFields({ a: "x", b: 4, c: true, d: null, e: new Date("2026-11-08T00:00:00Z") })).toEqual({
      a: { stringValue: "x" }, b: { integerValue: "4" }, c: { booleanValue: true }, d: { nullValue: null },
      e: { timestampValue: "2026-11-08T00:00:00.000Z" },
    });
  });

  test("a fractional number is refused: money is whole toea (I7)", () => {
    expect(() => s.encodeFields({ priceToea: 40.5 })).toThrow("whole");
  });
});

describe("ops/plans.ts", () => {
  test("writes only the plans not already there, each only if still absent", () => {
    const writes = s.planWrites("sasimem-dev", new Set(["free"]));
    expect(writes.map((w) => w.update.name)).toEqual([`${P}/plans/standard`, `${P}/plans/plus`]);
    expect(writes[0]?.currentDocument).toEqual({ exists: false });
    expect(writes[0]?.update.fields["priceToeaAnnual"]).toEqual({ integerValue: "40000" });
  });
});

describe("ops/backfill-subscriptions.ts (D6)", () => {
  test("Port Moresby's day, ten hours ahead of UTC with no daylight saving", () => {
    expect(s.portMoresbyToday(now)).toBe("2026-11-09");
  });

  test("an org without a subscription gets a free one counting its tenancies that have not ended", () => {
    const orgs = [
      { id: "a", tenancyEndDates: [null, "2026-12-31", "2026-11-08", null] as (CalendarDate | null)[] },
      { id: "b", tenancyEndDates: [] },
    ];
    const writes = s.backfillWrites("sasimem-dev", orgs, new Set(["b"]), now);
    expect(writes).toHaveLength(1); // b already has one
    expect(writes[0]?.update.name).toBe(`${P}/subscriptions/a`);
    expect(writes[0]?.currentDocument).toEqual({ exists: false }); // safe to run twice
    expect(writes[0]?.update.fields).toMatchObject({
      status: { stringValue: "free" }, activeTenancyCount: { integerValue: "3" }, tenancyLimit: { integerValue: "3" },
      limitOverride: { integerValue: "3" }, createdAt: { timestampValue: now.toISOString() },
    });
  });
});

describe("ops/grant-staff.ts (PLAN-ADMIN-DASHBOARD A1)", () => {
  test("the roles are core's", () => {
    expect(s.OPS_STAFF_ROLES).toEqual(STAFF_ROLES);
  });

  test("sets staffRole, keeps a landlord's orgIds and drops the old operator claim", () => {
    expect(JSON.parse(s.staffClaims(JSON.stringify({ orgIds: ["o1"], operator: true }), "owner"))).toEqual({ orgIds: ["o1"], staffRole: "owner" });
    expect(JSON.parse(s.staffClaims(undefined, "viewer"))).toEqual({ staffRole: "viewer" });
    expect(JSON.parse(s.staffClaims("", "manager"))).toEqual({ staffRole: "manager" });
  });

  test("--revoke removes staffRole and nothing else", () => {
    expect(JSON.parse(s.staffClaims(JSON.stringify({ orgIds: ["o1"], staffRole: "owner" }), null))).toEqual({ orgIds: ["o1"] });
  });

  test("writes the record (replaced) and a create-only audit entry", () => {
    const now = new Date("2026-11-19T00:00:00Z");
    const [record, event] = s.staffWrites("sasimem-dev", { uid: "u1", email: "joe@sasimem.example" }, "owner", false, now, "ev1");
    expect(record?.update.name).toBe(`${P}/staff/u1`);
    expect(record?.currentDocument).toBeUndefined();
    expect(record?.update.fields).toMatchObject({ role: { stringValue: "owner" }, status: { stringValue: "active" }, lastSeenAt: { nullValue: null } });
    expect(event?.update.name).toBe(`${P}/operatorEvents/ev1`);
    expect(event?.currentDocument).toEqual({ exists: false });
    expect(event?.update.fields).toMatchObject({ kind: { stringValue: "staffInvited" }, actor: { stringValue: "ops/grant-staff.ts" } });
    const [removed, gone] = s.staffWrites("sasimem-dev", { uid: "u1", email: "joe@sasimem.example" }, "owner", true, now, "ev2");
    expect(removed?.update.fields).toMatchObject({ status: { stringValue: "removed" } });
    expect(gone?.update.fields).toMatchObject({ kind: { stringValue: "staffRemoved" } });
  });
});

describe("ops/billing-details.ts (S4)", () => {
  test("replaces sasimem/billing with the details given, optional ones null when left out", () => {
    const w = s.billingDetailsWrite("sasimem-dev", { accountName: " Sasimem Ltd ", bankName: "BSP", accountNumber: "1001 2345 678" });
    expect(w.update.name).toBe(`${P}/sasimem/billing`);
    expect(w.currentDocument).toBeUndefined();
    expect(w.update.fields).toEqual({
      accountName: { stringValue: "Sasimem Ltd" }, bankName: { stringValue: "BSP" }, accountNumber: { stringValue: "1001 2345 678" },
      branch: { nullValue: null }, contactEmail: { nullValue: null },
    });
  });

  test("refuses missing details and a contact that is not an email address", () => {
    expect(() => s.billingDetailsWrite("sasimem-dev", { bankName: "BSP", accountNumber: "1" })).toThrow("--account-name is required");
    expect(() => s.billingDetailsWrite("sasimem-dev", { accountName: "S", bankName: "BSP", accountNumber: "1", contactEmail: "help" })).toThrow("--contact-email");
  });
});
