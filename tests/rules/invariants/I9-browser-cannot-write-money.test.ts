/**
 * Invariant I9 (plan §1): the browser cannot write money state. Runs, invoices,
 * issued numbers, emails, approval tokens, the counter, memberships and user
 * records, and subscribers' plans, status and payments are written only by Cloud Functions through the Admin SDK.
 */
import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, test } from "vitest";
import { seedOrg } from "../fixtures.js";
import { rulesEnv } from "../harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const serverOnly = (orgId: string, uid: string): string[] => [
  `orgs/${orgId}/runs/2026-10`,
  `orgs/${orgId}/invoices/t1_2026-10`,
  `orgs/${orgId}/issuedNumbers/1`,
  `orgs/${orgId}/emails/e1`,
  `orgs/${orgId}/events/ev1`,
  `orgs/${orgId}/private/counter`,
  `orgs/${orgId}/members/${uid}`,
  `orgs/${orgId}/members/someone-else`,
  `approvalTokens/tok-${orgId}`,
  `users/${uid}`,
  // Subscribers (PLAN-SUBSCRIBERS §2): plan, status, limits and payments are server-only too.
  `subscriptions/${orgId}`,
  `subscriptions/${orgId}/payments/pay1`,
  `subscriptions/${orgId}/notes/n1`,
  `plans/standard`,
  `operatorEvents/ev1`,
  `signupInvites/someone@example.com`,
  `private/subscriptionCounter`,
  `system/tick`,
];

describe("I9: an owner cannot write money state from the browser", () => {
  test("not by creating or overwriting any server-only document", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    for (const path of serverOnly(s.orgId, s.ownerUid)) {
      await assertFails(setDoc(doc(owner, path), { status: "approved", totalToea: 1 }));
    }
  });

  test("not by deleting any server-only document", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    for (const path of serverOnly(s.orgId, s.ownerUid)) {
      await assertFails(deleteDoc(doc(owner, path)));
    }
  });

  test("not by creating an organisation directly: createOrg does that", async () => {
    const owner = env.authenticatedContext("new-landlord").firestore();
    await assertFails(setDoc(doc(owner, "orgs/my-own-org"), { name: "Mine" }));
  });
});
