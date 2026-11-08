/** Invariant I3 (plan §1): numbers are unique, sequential, and allocated at approval, never at draft. */
import { parsePeriod } from "@sasimem/core";
import { describe, expect, test } from "vitest";
import { approveRun } from "../../src/store/approval.js";
import { draftRun } from "../../src/store/runs.js";
import { adminDb } from "../harness/index.js";
import { anOrgWith } from "../harness/seed.js";

const OCT = parsePeriod("2026-10");
const now = new Date("2026-09-28T00:00:00Z");

describe("I3: invoice numbers", () => {
  test("are given at approval, from the counter, by tenant name then tenancy ID, with no gap for an excluded invoice", async () => {
    const { orgId } = await anOrgWith({
      firstInvoiceNumber: 142,
      tenancies: [{ id: "k1", tenantName: "Peter" }, { id: "k2", tenantName: "Mary" }, { id: "k3", tenantName: "Anna" }, { id: "k4", tenantName: "Mary" }],
    });
    await draftRun(orgId, OCT, now);
    expect((await adminDb().collection(`orgs/${orgId}/invoices`).where("number", "!=", null).get()).size).toBe(0); // none at draft
    await adminDb().doc(`orgs/${orgId}/invoices/k3_2026-10`).update({ status: "excluded" });
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    const numbers = Object.fromEntries((await adminDb().collection(`orgs/${orgId}/invoices`).get()).docs.map((d) => [d.id, d.get("number")]));
    expect(numbers).toEqual({ "k2_2026-10": "INV-0142", "k4_2026-10": "INV-0143", "k1_2026-10": "INV-0144", "k3_2026-10": null });
  });

  test("each number has an issuedNumbers document, and the counter moves past the last", async () => {
    const { orgId } = await anOrgWith({ firstInvoiceNumber: 7, tenancies: [{ id: "k1" }, { id: "k2" }] });
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    const issued = await adminDb().collection(`orgs/${orgId}/issuedNumbers`).get();
    expect(issued.docs.map((d) => [d.id, d.get("invoiceId")]).sort()).toEqual([["7", "k1_2026-10"], ["8", "k2_2026-10"]]);
    expect((await adminDb().doc(`orgs/${orgId}/private/counter`).get()).get("nextInvoiceNumber")).toBe(9);
  });
});
