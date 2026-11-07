import { describe, expect, test } from "vitest";
import { onPropertyUpdated, onTenantUpdated } from "../src/triggers/syncTenancyCopies.js";
import { adminDb, randomOrgId } from "./harness/index.js";

/** An org with one property (two units), two tenants, and a tenancy each, written directly. */
async function seed(orgId = randomOrgId()) {
  const db = adminDb();
  const org = `orgs/${orgId}`;
  await db.doc(`${org}/properties/p1`).set({ address: "Lot 4, Boroko", useType: "residential", units: [{ id: "u1", label: "Flat 1" }, { id: "u2", label: "Flat 2" }] });
  await db.doc(`${org}/tenants/t1`).set({ name: "Peter Kila", email: "peter@kila.example", phone: "" });
  await db.doc(`${org}/tenants/t2`).set({ name: "Mary Wari", email: "mary@wari.example", phone: "" });
  const tenancy = (tenantId: string, tenantName: string, unitId: string, unitLabel: string) => ({
    propertyId: "p1", unitId, tenantId, tenantName, unitLabel, propertyAddress: "Lot 4, Boroko", useType: "residential",
    rentToea: 120_000, startDate: "2026-01-01", endDate: null, billingDay: 1, dueDays: 7, referenceCode: "KILA", invoiced: false, extras: [],
  });
  await db.doc(`${org}/tenancies/k1`).set(tenancy("t1", "Peter Kila", "u1", "Flat 1"));
  await db.doc(`${org}/tenancies/k2`).set(tenancy("t2", "Mary Wari", "u2", "Flat 2"));
  return { orgId, org };
}

/** The trigger as Firestore would call it after an update; only the params matter to it. */
const fire = (fn: { run: (event: never) => unknown }, params: Record<string, string>) => fn.run({ params } as never);

const copiesOf = async (path: string) => {
  const d = (await adminDb().doc(path).get()).data() ?? {};
  return { tenantName: d["tenantName"], unitLabel: d["unitLabel"], propertyAddress: d["propertyAddress"], useType: d["useType"] };
};

describe("keeping a tenancy's copies true (plan §4)", () => {
  test("renaming a tenant renames them on their tenancies, and only theirs", async () => {
    const { orgId, org } = await seed();
    await adminDb().doc(`${org}/tenants/t1`).update({ name: "Peter Kila Jr" });
    await fire(onTenantUpdated, { orgId, tenantId: "t1" });
    expect((await copiesOf(`${org}/tenancies/k1`)).tenantName).toBe("Peter Kila Jr");
    expect((await copiesOf(`${org}/tenancies/k2`)).tenantName).toBe("Mary Wari");
  });

  test("never reaches into another organisation with the same IDs", async () => {
    const a = await seed();
    const b = await seed();
    await adminDb().doc(`${a.org}/tenants/t1`).update({ name: "Renamed" });
    await fire(onTenantUpdated, { orgId: a.orgId, tenantId: "t1" });
    expect((await copiesOf(`${b.org}/tenancies/k1`)).tenantName).toBe("Peter Kila");
  });

  test("a property's new address, use and unit labels reach its tenancies", async () => {
    const { orgId, org } = await seed();
    await adminDb().doc(`${org}/properties/p1`).update({
      address: "Lot 4A, Boroko", useType: "commercial", units: [{ id: "u1", label: "Shop 1" }, { id: "u2", label: "Shop 2" }],
    });
    await fire(onPropertyUpdated, { orgId, propertyId: "p1" });
    expect(await copiesOf(`${org}/tenancies/k1`)).toEqual({ tenantName: "Peter Kila", unitLabel: "Shop 1", propertyAddress: "Lot 4A, Boroko", useType: "commercial" });
    expect((await copiesOf(`${org}/tenancies/k2`)).unitLabel).toBe("Shop 2");
  });

  test("an update that changes no copied field writes nothing", async () => {
    const { orgId, org } = await seed();
    const before = (await adminDb().doc(`${org}/tenancies/k1`).get()).updateTime;
    await adminDb().doc(`${org}/tenants/t1`).update({ phone: "7000 1111" });
    await fire(onTenantUpdated, { orgId, tenantId: "t1" });
    expect((await adminDb().doc(`${org}/tenancies/k1`).get()).updateTime).toEqual(before);
  });
});
