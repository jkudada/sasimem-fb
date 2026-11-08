/**
 * Invariant I6 (plan §1): nothing reaches a tenant unless its run was approved, and
 * never twice. The send step requires a PDF. (The tick-level cases - overlapping
 * ticks, a run never approved - are in tick.test.ts.)
 */
import { parsePeriod } from "@sasimem/core";
import { describe, expect, test } from "vitest";
import { approveRun } from "../../src/store/approval.js";
import { renderMissingPdfs } from "../../src/store/pdfs.js";
import { releaseRun } from "../../src/store/release.js";
import { draftRun } from "../../src/store/runs.js";
import { adminDb } from "../harness/index.js";
import { anOrgWith } from "../harness/seed.js";

const OCT = parsePeriod("2026-10");
const drafted = new Date("2026-09-28T00:00:00Z");
const SEND = new Date("2026-09-30T22:00:00Z");

describe("I6: only an approved run is released, once, and never without its PDFs", () => {
  test("an approved invoice with no PDF stops the release: nothing is marked sent", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, OCT, drafted);
    await approveRun(orgId, OCT, { actor: "uid", now: drafted }); // no PDF rendered
    expect(await releaseRun(orgId, OCT, SEND)).toEqual({ released: false, reason: "missingPdf" });
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).get("status")).toBe("approved");
    expect((await adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`).get()).get("status")).toBe("approved");
  });

  test("a run that was never approved is never released, even long after its send time", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, OCT, drafted);
    for (const status of ["draft", "awaitingApproval", "held", "cancelled"]) {
      await adminDb().doc(`orgs/${orgId}/runs/2026-10`).update({ status });
      expect(await releaseRun(orgId, OCT, new Date("2026-12-01T00:00:00Z")), status).toEqual({ released: false, reason: "notDue" });
    }
  });

  test("releasing twice releases once: the second finds nothing to send", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, OCT, drafted);
    await approveRun(orgId, OCT, { actor: "uid", now: drafted });
    await renderMissingPdfs(orgId, OCT);
    const [a, b] = await Promise.all([releaseRun(orgId, OCT, SEND), releaseRun(orgId, OCT, SEND)]);
    const won = [a, b].filter((o) => o.released);
    expect(won).toHaveLength(1);
    expect(won[0]?.released === true && won[0].invoices.map((i) => i.id)).toEqual(["k1_2026-10"]);
  });
});
