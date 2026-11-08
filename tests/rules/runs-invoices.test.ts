import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

async function withRun() {
  const s = await seedOrg(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/runs/2026-10`), { status: "draft", totalToea: 120_000 });
    await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/invoices/k1_2026-10`), { status: "draft", totalToea: 120_000 });
  });
  return s;
}

test("a member can read their organisation's runs and invoices (the review screen)", async () => {
  const s = await withRun();
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  await assertSucceeds(getDoc(doc(owner, `orgs/${s.orgId}/runs/2026-10`)));
  await assertSucceeds(getDocs(collection(owner, `orgs/${s.orgId}/invoices`)));
});

test("a stranger cannot read another organisation's runs or invoices", async () => {
  const s = await withRun();
  const stranger = env.authenticatedContext("stranger").firestore();
  await assertFails(getDoc(doc(stranger, `orgs/${s.orgId}/runs/2026-10`)));
  await assertFails(getDocs(collection(stranger, `orgs/${s.orgId}/invoices`)));
});
