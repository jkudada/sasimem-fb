import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

test("the browser can neither read nor write sign-up invitations, not even its own (docs/PLAN-TEMPLATES.md §7)", async () => {
  const s = await seedOrg(env);
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "signupInvites/mary@wari.example"), { invitedAt: new Date() }));
  for (const db of [env.authenticatedContext(s.ownerUid, { email: "mary@wari.example", email_verified: true }).firestore(), env.unauthenticatedContext().firestore()]) {
    const invite = doc(db, "signupInvites/mary@wari.example");
    await assertFails(getDoc(invite));
    await assertFails(setDoc(doc(db, "signupInvites/new@wari.example"), { invitedAt: new Date() }));
    await assertFails(setDoc(invite, { usedBy: null }));
    await assertFails(deleteDoc(invite));
  }
});
