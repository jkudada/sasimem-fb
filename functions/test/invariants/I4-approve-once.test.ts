/** Invariant I4 (plan §1): approving twice (two taps, two tabs) allocates numbers once. */
import { parsePeriod } from "@sasimem/core";
import { describe, expect, test } from "vitest";
import { approveRun } from "../../src/store/approval.js";
import { draftRun } from "../../src/store/runs.js";
import { adminDb } from "../harness/index.js";
import { anOrgWith } from "../harness/seed.js";

const OCT = parsePeriod("2026-10");
const now = new Date("2026-09-28T00:00:00Z");

describe("I4: approve once", () => {
  test("two concurrent approvals produce one set of numbers", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }, { id: "k2" }, { id: "k3" }] });
    await draftRun(orgId, OCT, now);
    const outcomes = await Promise.all([approveRun(orgId, OCT, { actor: "tab-1", now }), approveRun(orgId, OCT, { actor: "tab-2", now })]);
    expect(outcomes.sort()).toEqual(["alreadyApproved", "approved"]);
    expect((await adminDb().collection(`orgs/${orgId}/issuedNumbers`).get()).size).toBe(3);
    expect((await adminDb().doc(`orgs/${orgId}/private/counter`).get()).get("nextInvoiceNumber")).toBe(4);
  });

  test("approving an approved run changes nothing", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    const before = (await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).updateTime;
    expect(await approveRun(orgId, OCT, { actor: "uid-1", now: new Date("2026-09-29T00:00:00Z") })).toBe("alreadyApproved");
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).updateTime).toEqual(before);
  });
});
