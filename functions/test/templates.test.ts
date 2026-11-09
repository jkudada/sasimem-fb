import { CLASSIC, type InvoiceTemplate, parsePeriod } from "@sasimem/core";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { bucket } from "../src/admin.js";
import { makeTemplateCallables } from "../src/callables/templates.js";
import { approveRun } from "../src/store/approval.js";
import { renderMissingPdfs } from "../src/store/pdfs.js";
import { draftRun } from "../src/store/runs.js";
import { request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { pdfText } from "./harness/pdf-text.js";
import { anOrgWith } from "./harness/seed.js";

const OCT = parsePeriod("2026-10");
const now = new Date("2026-09-28T00:00:00Z");
const band: InvoiceTemplate = { name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "monogram", footer: "Thank you, from the band." };
const snapshotOf = async (orgId: string, id: string) => (await adminDb().doc(`orgs/${orgId}/invoices/${id}`).get()).get("snapshot");

describe("approval freezes the template (docs/PLAN-TEMPLATES.md §3)", () => {
  test("every invoice gets the org's default template, settings and all", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }, { id: "k2" }] });
    await adminDb().doc(`orgs/${orgId}/templates/t1`).set(band);
    await adminDb().doc(`orgs/${orgId}`).update({ defaultTemplateId: "t1" });
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    for (const id of ["k1_2026-10", "k2_2026-10"]) expect((await snapshotOf(orgId, id)).template).toEqual(band);
  });

  test("with no default, or a default that was deleted, invoices print as Classic", async () => {
    const a = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(a.orgId, OCT, now);
    await approveRun(a.orgId, OCT, { actor: "uid-1", now });
    expect((await snapshotOf(a.orgId, "k1_2026-10")).template).toEqual(CLASSIC);

    const b = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await adminDb().doc(`orgs/${b.orgId}`).update({ defaultTemplateId: "gone" });
    await draftRun(b.orgId, OCT, now);
    await approveRun(b.orgId, OCT, { actor: "uid-1", now });
    expect((await snapshotOf(b.orgId, "k1_2026-10")).template).toEqual(CLASSIC);
  });

  test("one run with three tenancies freezes three templates: org default, property override, tenancy override (P2)", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }, { id: "k2" }, { id: "k3" }] });
    const compact: InvoiceTemplate = { ...band, name: "Plain", layout: "compact" };
    const office: InvoiceTemplate = { ...band, name: "Office", layout: "classic", accent: "#a3312a" };
    const db = adminDb();
    await Promise.all([
      db.doc(`orgs/${orgId}/templates/t1`).set(band), db.doc(`orgs/${orgId}/templates/t2`).set(compact), db.doc(`orgs/${orgId}/templates/t3`).set(office),
      db.doc(`orgs/${orgId}`).update({ defaultTemplateId: "t1" }),
      db.doc(`orgs/${orgId}/properties/prop-k2`).update({ templateId: "t2" }),
      db.doc(`orgs/${orgId}/properties/prop-k3`).update({ templateId: "t2" }),
      db.doc(`orgs/${orgId}/tenancies/k3`).update({ templateId: "t3" }),
    ]);
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    expect((await snapshotOf(orgId, "k1_2026-10")).template).toEqual(band);
    expect((await snapshotOf(orgId, "k2_2026-10")).template).toEqual(compact);
    expect((await snapshotOf(orgId, "k3_2026-10")).template).toEqual(office);
  });

  test("a deleted override falls through to the next level at approval", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await adminDb().doc(`orgs/${orgId}/templates/t1`).set(band);
    await adminDb().doc(`orgs/${orgId}/properties/prop-k1`).update({ templateId: "t1" });
    await adminDb().doc(`orgs/${orgId}/tenancies/k1`).update({ templateId: "gone" });
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    expect((await snapshotOf(orgId, "k1_2026-10")).template).toEqual(band);
  });

  test("editing or deleting the template after approval changes neither the snapshot nor the PDF (I5)", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await adminDb().doc(`orgs/${orgId}/templates/t1`).set(band);
    await adminDb().doc(`orgs/${orgId}`).update({ defaultTemplateId: "t1" });
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "uid-1", now });
    await adminDb().doc(`orgs/${orgId}/templates/t1`).update({ layout: "compact", footer: "Changed later." });
    await renderMissingPdfs(orgId, OCT); // rendered after the edit, from the frozen snapshot
    await adminDb().doc(`orgs/${orgId}/templates/t1`).delete();
    expect((await snapshotOf(orgId, "k1_2026-10")).template).toEqual(band);
    const [pdf] = await bucket().file(`invoices/${orgId}/k1_2026-10.pdf`).download();
    expect(pdf.toString("latin1")).toMatch(/\/BaseFont \/Times-Roman/);
    expect(pdf.length).toBeGreaterThan(0);
  });
});

describe("previewInvoicePdf (docs/PLAN-TEMPLATES.md §4)", () => {
  const { previewInvoicePdf } = makeTemplateCallables({ now: () => new Date("2026-11-08T00:00:00Z") });
  const call = (uid: string | null, data: unknown) => previewInvoicePdf.run(request(uid, data));

  test("gives the owner a sample PDF with their details and the settings being edited, and stores nothing", async () => {
    const { uid, orgId } = await anOrgWith();
    const reply = await call(uid, { orgId, template: band });
    expect(reply.filename).toBe("sample-invoice.pdf");
    const pdf = Buffer.from(reply.base64, "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const [files] = await bucket().getFiles({ prefix: `invoices/${orgId}/` });
    expect(files).toEqual([]);
    expect(pdf.toString("latin1")).toMatch(/\/BaseFont \/Times-Roman/);
  });

  test("is the real renderer on core's sample invoice: the org, a sample tenant, this month and the note", async () => {
    const { uid, orgId } = await anOrgWith();
    const reply = await call(uid, { orgId, template: { ...band, layout: "compact" } });
    const { renderInvoicePdf } = await import("../src/pdf.js");
    const { sampleInvoice } = await import("@sasimem/core");
    const org = (await adminDb().doc(`orgs/${orgId}`).get()).data() as Parameters<typeof sampleInvoice>[0];
    const same = await renderInvoicePdf(sampleInvoice(org, { ...band, layout: "compact" }, "2026-11-08" as never), null);
    expect(Buffer.from(reply.base64, "base64").equals(same)).toBe(true);
    const text = pdfText(await renderInvoicePdf(sampleInvoice(org, band, "2026-11-08" as never), null, { compress: false })).join("\n");
    for (const want of ["Wari Holdings", "Sample Tenant", "November 2026", "Thank you, from the band.", "INV-SAMPLE"]) expect(text).toContain(want);
  });

  test("uses the uploaded logo when the template shows it, and initials when the logo is missing", async () => {
    const { uid, orgId } = await anOrgWith();
    const logo = await sharp({ create: { width: 80, height: 30, channels: 3, background: "#1f4e8c" } }).png().toBuffer();
    await bucket().file(`logos/${orgId}/1.png`).save(logo, { contentType: "image/png" });
    await adminDb().doc(`orgs/${orgId}`).update({ logoPath: `logos/${orgId}/1.png` });
    const withLogo = Buffer.from((await call(uid, { orgId, template: { ...band, mark: "logo" } })).base64, "base64");
    expect(withLogo.toString("latin1")).toMatch(/\/Subtype \/Image/);
    await adminDb().doc(`orgs/${orgId}`).update({ logoPath: `logos/${orgId}/missing.png` });
    const lost = Buffer.from((await call(uid, { orgId, template: { ...band, mark: "logo" } })).base64, "base64");
    expect(lost.toString("latin1")).not.toMatch(/\/Subtype \/Image/);
  });

  test("refuses anyone but the owner, and a template the rules would refuse", async () => {
    const { uid, orgId } = await anOrgWith();
    const other = await anOrgWith();
    await expect(call(null, { orgId, template: band })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(call(other.uid, { orgId, template: band })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call(uid, { orgId, template: { ...band, accent: "#ff0000" } })).rejects.toMatchObject({ code: "invalid-argument", message: "Choose one of the colours." });
    await expect(call(uid, { orgId, template: { ...band, footer: 7 } })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call(uid, { orgId })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
