import { assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
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
