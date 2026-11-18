import { expect, test } from "vitest";
import { adminDb, randomOrgId, workerProjectId } from "./harness/index.js";

test("each worker of each run writes to its own emulator project, under a random org per test", async () => {
  expect(workerProjectId()).toMatch(/^demo-sasimem-[0-9a-z]+-\d+$/);
  expect(workerProjectId()).toBe(`demo-sasimem-${process.env["SASIMEM_T3_RUN"]}-${process.env["VITEST_POOL_ID"]}`);
  const orgId = randomOrgId();
  await adminDb().doc(`orgs/${orgId}`).create({ name: "Harness check" });
  const snap = await adminDb().doc(`orgs/${orgId}`).get();
  expect(snap.get("name")).toBe("Harness check");
});
