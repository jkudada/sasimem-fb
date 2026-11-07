import { assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { randomOrgId, rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

test("a signed-in stranger cannot read another landlord's organisation", async () => {
  const orgId = randomOrgId();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `orgs/${orgId}`), { name: "Wari Holdings" });
  });
  const stranger = env.authenticatedContext("stranger-uid").firestore();
  const result = await assertFails(getDoc(doc(stranger, `orgs/${orgId}`)));
  expect(result).toBeDefined();
});
