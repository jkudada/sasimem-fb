import { describe, expect, test } from "vitest";
import { approveRunCallable, exclude, include, rebuildRun, setRent } from "../src/callables/edits.js";
import { draftRun } from "../src/store/runs.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { anOrgWith } from "./harness/seed.js";

const OCT = "2026-10" as never;
const now = new Date("2026-09-28T00:00:00Z");
const invoice = (orgId: string, id = "k1_2026-10") => adminDb().doc(`orgs/${orgId}/invoices/${id}`).get();
const runDoc = (orgId: string) => adminDb().doc(`orgs/${orgId}/runs/2026-10`);

async function drafted(tenancies = [{ id: "k1", rent: 120_000, useType: "commercial" as const }, { id: "k2", rent: 90_000 }]) {
  const seeded = await anOrgWith({ org: { gstRegistered: true, gstNumber: "500012345" }, tenancies });
  await draftRun(seeded.orgId, OCT, now);
  return seeded;
}

describe("editing a run from the console (plan §6.2)", () => {
  test("setRent changes one invoice's rent for this month and re-totals it, GST and the run's total included", async () => {
    const { uid, orgId } = await drafted();
    await setRent.run(request(uid, { orgId, invoiceId: "k1_2026-10", rentToea: 100_000 }));
    expect((await invoice(orgId)).data()).toMatchObject({ subtotalToea: 100_000, gstToea: 10_000, totalToea: 110_000 });
    expect((await runDoc(orgId).get()).get("totalToea")).toBe(200_000);
  });

  test("setRent refuses a float, a negative or a huge amount, in plain words", async () => {
    const { uid, orgId } = await drafted();
    for (const [rentToea, message] of [[100.5, "Enter an amount like K1,200.00."], [-1, "Rent cannot be negative."], [2_000_000_000, "That is more than K10,000,000.00. Check the amount."]] as const) {
      await expect(setRent.run(request(uid, { orgId, invoiceId: "k1_2026-10", rentToea }))).rejects.toMatchObject({ code: "invalid-argument", message });
    }
  });

  test("exclude and include move an invoice in and out of the batch, and the run's total follows", async () => {
    const { uid, orgId } = await drafted();
    await exclude.run(request(uid, { orgId, invoiceId: "k2_2026-10" }));
    expect((await invoice(orgId, "k2_2026-10")).get("status")).toBe("excluded");
    expect((await runDoc(orgId).get()).data()).toMatchObject({ totalToea: 132_000, invoiceCount: 1 });
    await include.run(request(uid, { orgId, invoiceId: "k2_2026-10" }));
    expect((await invoice(orgId, "k2_2026-10")).get("status")).toBe("draft");
    expect((await runDoc(orgId).get()).data()).toMatchObject({ totalToea: 222_000, invoiceCount: 2 });
  });

  test("nothing can be edited once the run is approved", async () => {
    const { uid, orgId } = await drafted();
    await approveRunCallable.run(request(uid, { orgId, period: "2026-10" }));
    const refused = { code: "failed-precondition", message: "October 2026 is already approved, so its invoices cannot change." };
    await expect(setRent.run(request(uid, { orgId, invoiceId: "k1_2026-10", rentToea: 1 }))).rejects.toMatchObject(refused);
    await expect(exclude.run(request(uid, { orgId, invoiceId: "k1_2026-10" }))).rejects.toMatchObject(refused);
    await expect(rebuildRun.run(request(uid, { orgId, period: "2026-10" }))).rejects.toMatchObject(refused);
  });

  test("rebuildRun redrafts from current tenancy data, discarding this month's rent edits, keeping exclusions", async () => {
    const { uid, orgId } = await drafted();
    await setRent.run(request(uid, { orgId, invoiceId: "k1_2026-10", rentToea: 1_000 }));
    await exclude.run(request(uid, { orgId, invoiceId: "k2_2026-10" }));
    await adminDb().doc(`orgs/${orgId}/tenancies/k2`).update({ rentToea: 95_000 });
    await rebuildRun.run(request(uid, { orgId, period: "2026-10" }));
    expect((await invoice(orgId)).get("subtotalToea")).toBe(120_000);
    expect((await invoice(orgId, "k2_2026-10")).data()).toMatchObject({ status: "excluded", subtotalToea: 95_000 });
    expect((await runDoc(orgId).get()).data()).toMatchObject({ totalToea: 132_000, invoiceCount: 1 });
  });

  test("rebuildRun adds a tenancy that started since, and drops one that ended", async () => {
    const { uid, orgId } = await drafted();
    await adminDb().doc(`orgs/${orgId}/tenancies/k2`).update({ endDate: "2026-09-30" });
    const { addTenancy } = await import("./harness/seed.js");
    await addTenancy(orgId, { id: "k3", rent: 50_000 });
    await rebuildRun.run(request(uid, { orgId, period: "2026-10" }));
    const ids = (await adminDb().collection(`orgs/${orgId}/invoices`).get()).docs.map((d) => d.id).sort();
    expect(ids).toEqual(["k1_2026-10", "k3_2026-10"]);
  });

  test("approveRun from the console approves with the same transaction as the page", async () => {
    const { uid, orgId } = await drafted();
    expect(await approveRunCallable.run(request(uid, { orgId, period: "2026-10" }))).toEqual({ status: "approved", message: "Approved 2 invoices. They go out at 8:00 am, Thursday 1 October 2026." });
    expect((await invoice(orgId)).get("number")).toBe("INV-0001");
    expect((await invoice(orgId)).get("pdfPath")).not.toBe("");
  });

  test("every edit is refused for someone who is not the organisation's owner", async () => {
    const { orgId } = await drafted();
    const stranger = await newUser();
    await expect(setRent.run(request(stranger, { orgId, invoiceId: "k1_2026-10", rentToea: 1 }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(approveRunCallable.run(request(stranger, { orgId, period: "2026-10" }))).rejects.toMatchObject({ code: "permission-denied" });
  });
});
