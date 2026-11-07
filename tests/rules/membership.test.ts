import { assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg, validTenancy } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

test("a member can read their own organisation and its tenancies", async () => {
  const s = await seedOrg(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/tenancies/x`), validTenancy(s));
  });
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  await assertSucceeds(getDoc(doc(owner, `orgs/${s.orgId}`)));
  await assertSucceeds(getDoc(doc(owner, `orgs/${s.orgId}/tenancies/x`)));
});
