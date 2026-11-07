import { Timestamp } from "firebase-admin/firestore";
import { parsePeriod } from "@sasimem/core";
import { describe, expect, test } from "vitest";
import { draftRun } from "../src/store/runs.js";
import { adminDb } from "./harness/index.js";
import { anOrgWith } from "./harness/seed.js";

const OCT = parsePeriod("2026-10");
const now = new Date("2026-09-27T00:00:00Z");

describe("drafting a run (plan §3.4, I1, I2)", () => {
  test("one draft invoice per active tenancy, keyed {tenancyId}_{period}, with core's totals", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1", rent: 120_000 }, { id: "k2", rent: 90_000 }, { id: "gone", endDate: "2026-09-30" }] });
    await draftRun(orgId, OCT, now);
    const invoices = await adminDb().collection(`orgs/${orgId}/invoices`).get();
    expect(invoices.docs.map((d) => d.id).sort()).toEqual(["k1_2026-10", "k2_2026-10"]);
    expect(invoices.docs.find((d) => d.id === "k1_2026-10")?.data()).toMatchObject({
      period: "2026-10", tenancyId: "k1", tenantId: "tenant-k1", tenantName: "Tenant k1", unitLabel: "Flat k1",
      status: "draft", number: null, numberSeq: null, snapshot: null, pdfPath: "",
      issueDate: "2026-10-01", dueDate: "2026-10-08", paymentReference: "K1-OCT26",
      subtotalToea: 120_000, gstToea: 0, totalToea: 120_000, documentTitle: "INVOICE",
      sentAt: null, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
    });
  });

  test("the run records its send time, invoice count and total, as a draft", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1", rent: 120_000, billingDay: 5 }, { id: "k2", rent: 90_000, billingDay: 3 }] });
    await draftRun(orgId, OCT, now);
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).data()).toMatchObject({
      status: "draft", invoiceCount: 2, totalToea: 210_000,
      sendAt: Timestamp.fromDate(new Date("2026-10-02T22:00:00Z")), // the 3rd at 08:00 Port Moresby
      createdAt: Timestamp.fromDate(now), approvalSentAt: null, approvedAt: null, sentAt: null,
    });
  });

  test("drafting the same month again creates nothing new, even after a tenancy is added", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    expect(await draftRun(orgId, OCT, now)).toBe("drafted");
    await adminDb().doc(`orgs/${orgId}/tenancies/k1`).update({ rentToea: 1 });
    expect(await draftRun(orgId, OCT, now)).toBe("exists");
    const invoices = await adminDb().collection(`orgs/${orgId}/invoices`).get();
    expect(invoices.size).toBe(1);
    expect(invoices.docs[0]?.get("totalToea")).toBe(120_000);
  });

  test("a month with no active tenancy is not drafted", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1", startDate: "2026-11-01" }] });
    expect(await draftRun(orgId, OCT, now)).toBe("nothingToDraft");
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).exists).toBe(false);
  });
});
