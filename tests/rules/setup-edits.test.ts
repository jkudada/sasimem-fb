import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, test } from "vitest";
import { seedOrg, validTenancy } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

describe("editing setup data (step 3)", () => {
  test("an owner can edit a property's address, use and units, and a tenant's details", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    const org = `orgs/${s.orgId}`;
    await assertSucceeds(updateDoc(doc(owner, `${org}/properties/${s.propertyId}`), {
      address: "Section 12, Lot 4A, Boroko", useType: "commercial", units: [{ id: s.unitId, label: "Shop 1" }, { id: "u2", label: "Shop 2" }],
    }));
    await assertSucceeds(updateDoc(doc(owner, `${org}/tenants/${s.tenantId}`), { name: "Peter Kila Jr", email: "pk@kila.example", phone: "7000 1111" }));
  });

  test("a stranger cannot edit or delete another organisation's properties and tenants", async () => {
    const s = await seedOrg(env);
    const stranger = env.authenticatedContext("stranger").firestore();
    const org = `orgs/${s.orgId}`;
    await assertFails(updateDoc(doc(stranger, `${org}/properties/${s.propertyId}`), { address: "Mine" }));
    await assertFails(updateDoc(doc(stranger, `${org}/tenants/${s.tenantId}`), { name: "Mine" }));
    await assertFails(deleteDoc(doc(stranger, `${org}/properties/${s.propertyId}`)));
    await assertFails(deleteDoc(doc(stranger, `${org}/tenants/${s.tenantId}`)));
  });

  test("an edited property or tenant is still validated", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    const property = doc(owner, `orgs/${s.orgId}/properties/${s.propertyId}`);
    const tenant = doc(owner, `orgs/${s.orgId}/tenants/${s.tenantId}`);
    await assertFails(updateDoc(property, { useType: "industrial" }));
    await assertFails(updateDoc(property, { units: [] }));
    await assertFails(updateDoc(property, { units: [{ id: "u1", label: "" }] }));
    await assertFails(updateDoc(property, { invoicedTotal: 5 }));
    await assertFails(updateDoc(tenant, { email: "peter" }));
    await assertFails(updateDoc(tenant, { name: "" }));
  });

  test("an owner can delete a property and a tenant", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    await assertSucceeds(deleteDoc(doc(owner, `orgs/${s.orgId}/tenants/${s.tenantId}`)));
    await assertSucceeds(deleteDoc(doc(owner, `orgs/${s.orgId}/properties/${s.propertyId}`)));
  });

  test("a tenancy can be ended and its charges edited, but a charge must still be whole toea", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    const tenancy = doc(owner, `orgs/${s.orgId}/tenancies/k1`);
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/tenancies/k1`), validTenancy(s, { invoiced: true })));
    const water = { id: "c1", description: "Water", amountToea: 5000, recurrence: "every", period: null, active: true, gstTreatment: "inherit" };
    await assertSucceeds(updateDoc(tenancy, { endDate: "2026-12-31", extras: [water, { ...water, id: "c2", recurrence: "one", period: "2026-11", amountToea: -2000 }] }));
    await assertFails(updateDoc(tenancy, { extras: [{ ...water, amountToea: 50.5 }] }));
    await assertFails(updateDoc(tenancy, { endDate: "2025-12-31" }));
  });
});

describe("the logo on the org profile", () => {
  test("may point into the org's own logos folder, and may be removed", async () => {
    const s = await seedOrg(env);
    const org = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}`);
    await assertSucceeds(updateDoc(org, { logoPath: `logos/${s.orgId}/1730000000000.png` }));
    await assertSucceeds(updateDoc(org, { logoPath: deleteField() }));
  });

  test("may not point anywhere else", async () => {
    const s = await seedOrg(env);
    const org = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}`);
    await assertFails(updateDoc(org, { logoPath: "logos/another-org/logo.png" }));
    await assertFails(updateDoc(org, { logoPath: `invoices/${s.orgId}/INV-0001.pdf` }));
    await assertFails(updateDoc(org, { logoPath: `logos/${s.orgId}/../x` }));
    await assertFails(updateDoc(org, { logoPath: 5 }));
  });
});
