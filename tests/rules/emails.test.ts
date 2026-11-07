import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

async function withEmail() {
  const s = await seedOrg(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/emails/e1`), { kind: "tenantInvoice", to: "k1@tenant.example", status: "sent" });
  });
  return s;
}

test("a member can read their organisation's email log (so a missing email shows up)", async () => {
  const s = await withEmail();
  await assertSucceeds(getDocs(collection(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}/emails`)));
});

test("a stranger cannot read another organisation's email log", async () => {
  const s = await withEmail();
  await assertFails(getDocs(collection(env.authenticatedContext("stranger").firestore(), `orgs/${s.orgId}/emails`)));
});
