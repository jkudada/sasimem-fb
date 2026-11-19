// G2c (docs/test-lists/general-g2.md): credit notes and customers' credit are server-written; members read them.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const docs: Record<string, Record<string, unknown>> = {
  "creditNotes/cn1": { invoiceId: "i1", invoiceNumber: "INV-0001", customerId: "t1", number: "CN-0001", reason: "Returned", totalToea: 1_000, pdfPath: "" },
  "credits/t1": { balanceToea: 2_500, customerName: "Kila" },
};

test("members read credit notes and credit; nobody writes them, the owner included", async () => {
  const s = await seedOrg(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/members/viewer`), { role: "member", addedAt: new Date() });
    for (const [p, d] of Object.entries(docs)) await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/${p}`), d);
  });
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  for (const [p, d] of Object.entries(docs)) {
    const path = `orgs/${s.orgId}/${p}`;
    await assertSucceeds(getDoc(doc(owner, path)));
    await assertSucceeds(getDoc(doc(env.authenticatedContext("viewer").firestore(), path)));
    await assertFails(getDoc(doc(env.authenticatedContext("stranger").firestore(), path)));
    await assertFails(setDoc(doc(owner, `${path}x`), d));
    await assertFails(updateDoc(doc(owner, path), { totalToea: 1 }));
    await assertFails(deleteDoc(doc(owner, path)));
  }
});
