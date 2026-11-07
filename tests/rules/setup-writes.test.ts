import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg, validTenancy } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

test("an owner can create a valid property, tenant and tenancy", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  const org = `orgs/${s.orgId}`;
  await assertSucceeds(addDoc(collection(owner, `${org}/properties`), { address: "Lot 9, Gordons", useType: "commercial", units: [{ id: "u1", label: "Shop 1" }] }));
  await assertSucceeds(addDoc(collection(owner, `${org}/tenants`), { name: "Kila Trading", email: "accounts@kila.example", phone: "7000 0000" }));
  await assertSucceeds(addDoc(collection(owner, `${org}/tenancies`), validTenancy(s)));
});

test("a signed-in stranger cannot create properties, tenants or tenancies in someone else's organisation", async () => {
  const s = await seedOrg(env);
  const stranger = env.authenticatedContext("stranger").firestore();
  const org = `orgs/${s.orgId}`;
  await assertFails(addDoc(collection(stranger, `${org}/properties`), { address: "Lot 9", useType: "commercial", units: [{ id: "u1", label: "Shop" }] }));
  await assertFails(addDoc(collection(stranger, `${org}/tenants`), { name: "X", email: "x@x.example", phone: "" }));
  await assertFails(addDoc(collection(stranger, `${org}/tenancies`), validTenancy(s)));
});

test("a property with an unknown use type, no units or extra fields is refused; so is a tenant without a valid email", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  const properties = collection(owner, `orgs/${s.orgId}/properties`);
  const ok = { address: "Lot 9, Gordons", useType: "commercial", units: [{ id: "u1", label: "Shop 1" }] };
  await assertFails(addDoc(properties, { ...ok, useType: "industrial" }));
  await assertFails(addDoc(properties, { ...ok, units: [] }));
  await assertFails(addDoc(properties, { ...ok, address: "" }));
  await assertFails(addDoc(properties, { ...ok, invoicedTotal: 5 }));
  const tenants = collection(owner, `orgs/${s.orgId}/tenants`);
  await assertFails(addDoc(tenants, { name: "Kila Trading", email: "kila", phone: "" }));
  await assertFails(addDoc(tenants, { name: "", email: "a@b.example", phone: "" }));
});

test("a tenancy whose rent is not a whole number of toea is refused (I7)", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  await assertFails(addDoc(collection(owner, `orgs/${s.orgId}/tenancies`), validTenancy(s, { rentToea: 1200.5 })));
  await assertFails(addDoc(collection(owner, `orgs/${s.orgId}/tenancies`), validTenancy(s, { rentToea: "1200" })));
  await assertFails(addDoc(collection(owner, `orgs/${s.orgId}/tenancies`), validTenancy(s, { rentToea: -1 })));
});

test("an additional charge must be whole toea too, and well formed (I7)", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  const tenancies = collection(owner, `orgs/${s.orgId}/tenancies`);
  const water = { id: "c1", description: "Water", amountToea: 5000, recurrence: "every", period: null, active: true, gstTreatment: "inherit" };
  await assertSucceeds(addDoc(tenancies, validTenancy(s, { extras: [water, { ...water, id: "c2", amountToea: -2000 }] })));
  await assertFails(addDoc(tenancies, validTenancy(s, { extras: [water, { ...water, id: "c2", amountToea: 50.5 }] })));
  await assertFails(addDoc(tenancies, validTenancy(s, { extras: [{ ...water, gstTreatment: "maybe" }] })));
  await assertFails(addDoc(tenancies, validTenancy(s, { extras: Array.from({ length: 11 }, (_, i) => ({ ...water, id: `c${i}` })) })));
});

test("a tenancy billed on day 0 or day 32 is refused", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  const tenancies = collection(owner, `orgs/${s.orgId}/tenancies`);
  await assertFails(addDoc(tenancies, validTenancy(s, { billingDay: 0 })));
  await assertFails(addDoc(tenancies, validTenancy(s, { billingDay: 32 })));
  await assertFails(addDoc(tenancies, validTenancy(s, { dueDays: 91 })));
  await assertSucceeds(addDoc(tenancies, validTenancy(s, { billingDay: 31, dueDays: 0 })));
});

test("a tenancy cannot be created marked invoiced: only the server sets that", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  await assertFails(addDoc(collection(owner, `orgs/${s.orgId}/tenancies`), validTenancy(s, { invoiced: true })));
});

test("a tenancy with a malformed date, an end before its start, a bad reference code or an unknown field is refused", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  const tenancies = collection(owner, `orgs/${s.orgId}/tenancies`);
  await assertFails(addDoc(tenancies, validTenancy(s, { startDate: "1 Jan 2026" })));
  await assertFails(addDoc(tenancies, validTenancy(s, { endDate: "2025-12-31" })));
  await assertFails(addDoc(tenancies, validTenancy(s, { referenceCode: "WARI-1" })));
  await assertFails(addDoc(tenancies, validTenancy(s, { totalOwedToea: 0 })));
  await assertSucceeds(addDoc(tenancies, validTenancy(s, { endDate: "2026-12-31" })));
});
