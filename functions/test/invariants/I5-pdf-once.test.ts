/** Invariant I5 (plan §1): a PDF is rendered once at approval and never regenerated or overwritten. */
import { parsePeriod } from "@sasimem/core";
import { getStorage } from "firebase-admin/storage";
import { describe, expect, test } from "vitest";
import { approveRun } from "../../src/store/approval.js";
import { renderMissingPdfs } from "../../src/store/pdfs.js";
import { draftRun } from "../../src/store/runs.js";
import { adminDb, workerProjectId } from "../harness/index.js";
import { anOrgWith } from "../harness/seed.js";

const OCT = parsePeriod("2026-10");
const now = new Date("2026-09-28T00:00:00Z");
const bucket = () => getStorage().bucket(`${workerProjectId()}.appspot.com`);

async function approved() {
  const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }, { id: "k2" }] });
  await draftRun(orgId, OCT, now);
  await approveRun(orgId, OCT, { actor: "uid-1", now });
  return orgId;
}

describe("I5: one PDF per invoice, never overwritten", () => {
  test("after approval each approved invoice has its PDF in Storage, and its pdfPath set", async () => {
    const orgId = await approved();
    expect(await renderMissingPdfs(orgId, OCT)).toBe(2);
    const invoice = (await adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`).get()).data();
    expect(invoice?.["pdfPath"]).toBe(`invoices/${orgId}/k1_2026-10.pdf`);
    const [bytes] = await bucket().file(`invoices/${orgId}/k1_2026-10.pdf`).download();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("rendering again finds nothing to do", async () => {
    const orgId = await approved();
    await renderMissingPdfs(orgId, OCT);
    expect(await renderMissingPdfs(orgId, OCT)).toBe(0);
  });

  test("a PDF already in Storage is never overwritten; the invoice just records its path", async () => {
    const orgId = await approved();
    const path = `invoices/${orgId}/k1_2026-10.pdf`;
    await bucket().file(path).save(Buffer.from("%PDF- the original"), { contentType: "application/pdf" });
    await renderMissingPdfs(orgId, OCT); // as after a crash between upload and recording the path
    const [bytes] = await bucket().file(path).download();
    expect(bytes.toString()).toBe("%PDF- the original");
    expect((await adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`).get()).get("pdfPath")).toBe(path);
  });

  test("a draft or excluded invoice gets no PDF", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, OCT, now);
    expect(await renderMissingPdfs(orgId, OCT)).toBe(0);
  });
});
