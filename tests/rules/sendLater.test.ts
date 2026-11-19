// G2d (docs/test-lists/general-g2.md): a draft's schedule is server-written; members read it.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const schedule = { sendOn: "2026-12-01", sendAt: new Date("2026-11-30T22:00:00Z"), scheduledBy: "u1", scheduledAt: new Date() };

test("members read a draft's schedule; nobody writes it, the owner included", async () => {
  const s = await seedOrg(env);
  const path = `orgs/${s.orgId}/sendLater/d1`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/members/viewer`), { role: "member", addedAt: new Date() });
    await setDoc(doc(ctx.firestore(), path), schedule);
  });
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  await assertSucceeds(getDoc(doc(owner, path)));
  await assertSucceeds(getDoc(doc(env.authenticatedContext("viewer").firestore(), path)));
  await assertFails(getDoc(doc(env.authenticatedContext("stranger").firestore(), path)));
  await assertFails(setDoc(doc(owner, `orgs/${s.orgId}/sendLater/d2`), schedule));
  await assertFails(updateDoc(doc(owner, path), { sendOn: "2026-12-02" }));
  await assertFails(deleteDoc(doc(owner, path)));
});
