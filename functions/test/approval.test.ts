import { parsePeriod } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { approveRun } from "../src/store/approval.js";
import { draftRun } from "../src/store/runs.js";
import { adminDb } from "./harness/index.js";
import { anOrgWith } from "./harness/seed.js";

const OCT = parsePeriod("2026-10");
const now = new Date("2026-09-28T00:00:00Z");

describe("approving a run (plan §6.3)", () => {
  test("freezes each invoice's snapshot, approves the run with approvedAt, and records an event", async () => {
    const { orgId } = await anOrgWith({ org: { gstRegistered: true, gstNumber: "500012345" }, tenancies: [{ id: "k1", tenantName: "Peter Kila", tenantEmail: "peter@kila.example" }] });
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    // A later change to the org or tenant never reaches an approved invoice.
    await adminDb().doc(`orgs/${orgId}`).update({ bankAccount: "9999" });
    const invoice = (await adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`).get()).data();
    expect(invoice).toMatchObject({
      status: "approved", number: "INV-0001", numberSeq: 1,
      snapshot: {
        org: { name: "Wari Holdings", bankAccount: "1000 2345 6789", gstRegistered: true, gstNumber: "500012345", logoPath: null },
        tenantName: "Peter Kila", tenantEmail: "peter@kila.example", unitLabel: "Flat k1", propertyAddress: "Lot k1, Boroko",
      },
    });
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).data()).toMatchObject({ status: "approved", approvedAt: Timestamp.fromDate(now) });
    const events = await adminDb().collection(`orgs/${orgId}/events`).get();
    expect(events.docs.map((d) => d.data())).toEqual([{ actor: "uid-1", kind: "runApproved", at: Timestamp.fromDate(now), target: "runs/2026-10", note: "1 invoice, K1,200.00" }]);
  });

  test("a cancelled run cannot be approved; a held one can, late", async () => {
    const a = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(a.orgId, OCT, now);
    await adminDb().doc(`orgs/${a.orgId}/runs/2026-10`).update({ status: "cancelled" });
    expect(await approveRun(a.orgId, OCT, { actor: "uid-1", now })).toBe("refused");
    const b = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(b.orgId, OCT, now);
    await adminDb().doc(`orgs/${b.orgId}/runs/2026-10`).update({ status: "held" });
    expect(await approveRun(b.orgId, OCT, { actor: "uid-1", now })).toBe("approved");
  });

  test("the page's rent edits and exclusions are applied in the same transaction, and the run's total follows", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1", rent: 120_000 }, { id: "k2", rent: 90_000 }] });
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "approval-link", now, edits: { rents: { "k1_2026-10": 100_000, "k2_2026-10": 90_000 } as never, included: ["k1_2026-10"] } });
    const k1 = (await adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`).get()).data();
    expect(k1).toMatchObject({ status: "approved", totalToea: 100_000 });
    expect((await adminDb().doc(`orgs/${orgId}/invoices/k2_2026-10`).get()).get("status")).toBe("excluded");
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).data()).toMatchObject({ totalToea: 100_000, invoiceCount: 1 });
  });
});
