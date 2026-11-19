// G2b (docs/test-lists/general-g2.md): payments are server-written; members read them.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const payment = {
  customerId: "t1", receivedOn: "2026-11-19", amountToea: 10_000, method: "bank", reference: "", note: "",
  allocations: [{ invoiceId: "i1", number: "INV-0001", amountToea: 10_000 }], creditToea: 0, receiptNumber: "RCT-0001", status: "recorded",
};

test("members read payments; nobody writes them, the owner included", async () => {
  const s = await seedOrg(env);
  const path = `orgs/${s.orgId}/payments/p1`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/members/viewer`), { role: "member", addedAt: new Date() });
    await setDoc(doc(ctx.firestore(), path), payment);
  });
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  await assertSucceeds(getDoc(doc(owner, path)));
  await assertSucceeds(getDoc(doc(env.authenticatedContext("viewer").firestore(), path)));
  await assertFails(getDoc(doc(env.authenticatedContext("stranger").firestore(), path)));
  await assertFails(setDoc(doc(owner, `orgs/${s.orgId}/payments/p2`), payment));
  await assertFails(updateDoc(doc(owner, path), { status: "undone" }));
  await assertFails(deleteDoc(doc(owner, path)));
});
