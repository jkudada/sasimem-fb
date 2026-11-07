import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

test("an owner can update their organisation's profile: letterhead, bank, GST and timing", async () => {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  await assertSucceeds(updateDoc(doc(owner, `orgs/${s.orgId}`), {
    name: "Wari Holdings Ltd", bankAccount: "1000 9999 0000", gstRegistered: true, gstNumber: "500012345",
    sendHour: 9, approvalLeadDays: 5, reminderAfterDays: 10, reminderMode: "off",
  }));
});

test("an owner cannot change createdAt or add fields, nor be GST-registered without a number, nor break the limits", async () => {
  const s = await seedOrg(env);
  const org = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}`);
  await assertFails(updateDoc(org, { createdAt: new Date() }));
  await assertFails(updateDoc(org, { plan: "free" }));
  await assertFails(updateDoc(org, { gstRegistered: true, gstNumber: "  " }));
  await assertFails(updateDoc(org, { sendHour: 24 }));
  await assertFails(updateDoc(org, { sendHour: 8.5 }));
  await assertFails(updateDoc(org, { email: "not-an-email" }));
  await assertFails(updateDoc(org, { invoicePrefix: "INVOICE-NO-" }));
  await assertFails(updateDoc(org, { reminderMode: "sometimes" }));
});

test("a member's stranger cannot update the organisation at all", async () => {
  const s = await seedOrg(env);
  await assertFails(updateDoc(doc(env.authenticatedContext("stranger").firestore(), `orgs/${s.orgId}`), { name: "Mine now" }));
});
