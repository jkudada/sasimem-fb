import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
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

test("an operator with a second factor reads invitations, for the console's Invites page, and still writes none (PLAN-SUBSCRIBERS S3)", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "signupInvites/ann@wari.example"), { invitedAt: new Date() }));
  const operator = env.authenticatedContext("op", { operator: true, firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } } as never).firestore();
  await assertSucceeds(getDoc(doc(operator, "signupInvites/ann@wari.example")));
  await assertSucceeds(getDocs(collection(operator, "signupInvites")));
  await assertFails(setDoc(doc(operator, "signupInvites/new@wari.example"), { invitedAt: new Date() }));
  await assertFails(deleteDoc(doc(operator, "signupInvites/ann@wari.example")));
  const noCode = env.authenticatedContext("op", { operator: true, firebase: { sign_in_provider: "password" } } as never).firestore();
  await assertFails(getDoc(doc(noCode, "signupInvites/ann@wari.example")));
});
