import { describe, expect, test } from "vitest";
import { makeOnTenancyWritten } from "../src/triggers/countTenancies.js";
import { adminDb, randomOrgId } from "./harness/index.js";

const now = new Date("2026-11-08T01:00:00Z"); // 8 November in Port Moresby
const onTenancyWritten = makeOnTenancyWritten({ now: () => now });
const fire = (orgId: string) => onTenancyWritten.run({ params: { orgId, tenancyId: "any" } } as never);

const tenancy = (endDate: string | null) => ({
  propertyId: "p1", unitId: "u1", tenantId: "t1", tenantName: "Peter Kila", unitLabel: "Flat 1", propertyAddress: "Lot 4",
  useType: "residential", rentToea: 120_000, startDate: "2026-01-01", endDate, billingDay: 1, dueDays: 7,
  referenceCode: "KILA", invoiced: false, extras: [],
});

async function seed(count: number, tenancies: Record<string, string | null>) {
  const orgId = randomOrgId();
  await adminDb().doc(`subscriptions/${orgId}`).set({ planId: "standard", status: "trial", tenancyLimit: 10, activeTenancyCount: count });
  for (const [id, endDate] of Object.entries(tenancies)) await adminDb().doc(`orgs/${orgId}/tenancies/${id}`).set(tenancy(endDate));
  return orgId;
}
const countOf = async (orgId: string) => (await adminDb().doc(`subscriptions/${orgId}`).get()).get("activeTenancyCount");

describe("keeping the tenancy count the limit rule reads (PLAN-SUBSCRIBERS §6)", () => {
  test("counts the org's tenancies that have not ended, whatever the old count said", async () => {
    const orgId = await seed(0, { k1: null, k2: "2026-12-31", k3: "2026-11-08", k4: "2026-11-07" });
    await fire(orgId);
    expect(await countOf(orgId)).toBe(3); // k4 ended yesterday
  });

  test("a drifted count is corrected, down as well as up", async () => {
    const orgId = await seed(7, { k1: null });
    await fire(orgId);
    expect(await countOf(orgId)).toBe(1);
  });

  test("never counts another org's tenancies", async () => {
    const a = await seed(0, { k1: null, k2: null });
    const b = await seed(0, { k1: null });
    await fire(b);
    expect(await countOf(b)).toBe(1);
    expect(await countOf(a)).toBe(0);
  });

  test("an org with no subscription is left alone: the trigger creates nothing", async () => {
    const orgId = randomOrgId();
    await adminDb().doc(`orgs/${orgId}/tenancies/k1`).set(tenancy(null));
    await fire(orgId);
    expect((await adminDb().doc(`subscriptions/${orgId}`).get()).exists).toBe(false);
  });

  test("an unchanged count is not rewritten", async () => {
    const orgId = await seed(1, { k1: null });
    const updated = async () => (await adminDb().doc(`subscriptions/${orgId}`).get()).updateTime?.valueOf();
    const before = await updated();
    await fire(orgId);
    expect(await updated()).toBe(before);
  });
});
