import { expect, test } from "vitest";
import { adminDb, randomOrgId, workerProjectId } from "./harness/index.js";

test("each worker writes to its own emulator project, under a random org per test", async () => {
  expect(workerProjectId()).toBe(`demo-sasimem-${process.env["VITEST_POOL_ID"]}`);
  const orgId = randomOrgId();
  await adminDb().doc(`orgs/${orgId}`).create({ name: "Harness check" });
  const snap = await adminDb().doc(`orgs/${orgId}`).get();
  expect(snap.get("name")).toBe("Harness check");
});
