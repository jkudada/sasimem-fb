import { assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
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
