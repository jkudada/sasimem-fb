/**
 * G2a (docs/test-lists/general-g2.md): issuing a one-off invoice. Pressing Send is the
 * say-so (D7): number, freeze, PDF, email - and never caught up in a rent run.
 */
import { parsePeriod } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeOneOffCallables } from "../src/callables/oneoff.js";
import { makePaymentCallables } from "../src/callables/payments.js";
import { approveRun } from "../src/store/approval.js";
import { rebuild } from "../src/store/edits.js";
import { renderMissingPdfs } from "../src/store/pdfs.js";
import { releaseRun } from "../src/store/release.js";
import { draftRun } from "../src/store/runs.js";
import { bucket } from "../src/admin.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { pdfText } from "./harness/pdf-text.js";
import { type TenancySeed, anOrgWith } from "./harness/seed.js";
import { renderInvoicePdf } from "../src/pdf.js";

const now = new Date("2026-11-19T01:00:00Z"); // 11:00 on 19 November in Port Moresby
const NOV = parsePeriod("2026-11");
const labour = { description: "Labour - rewire kitchen", detail: "", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };
const cable = { description: "Cable 2.5mm", detail: "Twin and earth", quantityMilli: 30_000, unit: "m", unitPriceToea: 450, taxCode: "standard" };

function setup() {
  const mailer = new FakeMailer();
  const deps = { now: () => now, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example" };
  return { ...makeOneOffCallables(deps), ...makePaymentCallables(deps), mailer };
}

/** An org with one-off invoicing on, a customer and a draft for them. */
async function aDraft(opts: { feature?: boolean; draft?: Record<string, unknown>; customer?: Record<string, unknown>; tenancies?: TenancySeed[] } = {}) {
  const seeded = await anOrgWith({ tenancies: opts.tenancies ?? [] });
  const org = adminDb().doc(`orgs/${seeded.orgId}`);
  if (opts.feature !== false) await org.update({ features: { rentals: true, repeating: true, oneOff: true } });
  await org.collection("tenants").doc("c1").set({
    name: "Kila Trading", email: "accounts@kila.example", phone: "", address: "Section 5, Gordons", tin: "500012345",
    ccEmails: ["boss@kila.example"], ...opts.customer,
  });
  const draft = org.collection("drafts").doc();
  await draft.set({ customerId: "c1", lines: [labour, cable], poNumber: "PO-7731", notes: "Thank you for your business.", dueDays: null, ...opts.draft });
  return { ...seeded, draftId: draft.id, org };
}

const issue = (c: ReturnType<typeof setup>, uid: string, orgId: string, draftId: string) => c.issueInvoice.run(request(uid, { orgId, draftId }));

describe("issuing a one-off invoice", () => {
  test("numbers it from the shared counter, freezes it, makes the PDF, emails the customer and their copy-to, and removes the draft", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft();
    expect(await issue(c, uid, orgId, draftId)).toEqual({ number: "INV-0001", message: "Sent INV-0001 to Kila Trading." });

    const inv = (await org.collection("invoices").doc(draftId).get()).data() ?? {};
    expect(inv).toMatchObject({
      status: "sent", sentAt: Timestamp.fromDate(now), number: "INV-0001", numberSeq: 1, paymentReference: "INV-0001",
      source: { kind: "oneOff", draftId }, tenantId: "c1", tenantName: "Kila Trading", unitLabel: "", tenancyId: "", period: "2026-11",
      issueDate: "2026-11-19", dueDate: "2026-12-03", subtotalToea: 25_500, gstToea: 0, totalToea: 25_500, documentTitle: "INVOICE",
      paidAt: null, remindedAt: null, remindersPaused: false,
      snapshot: { tenantName: "Kila Trading", tenantEmail: "accounts@kila.example", propertyAddress: "Section 5, Gordons", poNumber: "PO-7731",
        customer: { tin: "500012345", ccEmails: ["boss@kila.example"] }, notes: "Thank you for your business." },
    });
    expect(inv["pdfPath"]).toBe(`invoices/${orgId}/${draftId}.pdf`);
    expect((await org.collection("private").doc("counter").get()).get("nextInvoiceNumber")).toBe(2);
    expect((await org.collection("issuedNumbers").doc("1").get()).get("invoiceId")).toBe(draftId);
    expect((await org.collection("drafts").doc(draftId).get()).exists).toBe(false);
    expect((await org.collection("events").where("kind", "==", "invoiceIssued").get()).docs.map((d) => d.get("target"))).toEqual([`invoices/${draftId}`]);

    expect(c.mailer.sent).toHaveLength(1);
    expect(c.mailer.sent[0]).toMatchObject({ to: "accounts@kila.example", cc: ["boss@kila.example"] });
    expect(c.mailer.sent[0]?.attachments?.[0]?.filename).toBe("INV-0001.pdf");
    expect((await org.collection("emails").where("invoiceId", "==", draftId).get()).size).toBe(1);
  });

  test("the PDF prints quantities and prices, the customer's TIN and order number, and the notes; within 150 KB", async () => {
    const c = setup();
    const { uid, orgId, draftId } = await aDraft();
    await issue(c, uid, orgId, draftId);
    const [pdf] = await bucket().file(`invoices/${orgId}/${draftId}.pdf`).download();
    expect(pdf.length).toBeLessThan(150 * 1024);
    const inv = (await adminDb().doc(`orgs/${orgId}/invoices/${draftId}`).get()).data();
    const text = pdfText(await renderInvoicePdf(inv as never, null, { compress: false })).join("\n");
    for (const s of ["1.5 hour × K80.00", "30 m × K4.50", "Twin and earth", "TIN 500012345", "Your order PO-7731", "Thank you for your business.", "Section 5, Gordons"]) {
      expect(text).toContain(s);
    }
  });

  test("a GST-registered org charges GST on standard lines and issues a TAX INVOICE", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft();
    await org.update({ gstRegistered: true, gstNumber: "GST-100" });
    await issue(c, uid, orgId, draftId);
    expect((await org.collection("invoices").doc(draftId).get()).data()).toMatchObject({ gstToea: 2_550, totalToea: 28_050, documentTitle: "TAX INVOICE" });
  });

  test("issuing the same draft twice gives one invoice, one number and one email", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft();
    await issue(c, uid, orgId, draftId);
    expect(await issue(c, uid, orgId, draftId)).toEqual({ number: "INV-0001", message: "INV-0001 was already sent." });
    expect((await org.collection("private").doc("counter").get()).get("nextInvoiceNumber")).toBe(2);
    expect(c.mailer.sent).toHaveLength(1);
  });

  test("two sends of one draft at the same moment still make one invoice and one number", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft();
    const results = await Promise.all([issue(c, uid, orgId, draftId), issue(c, uid, orgId, draftId)]);
    expect(results.map((r) => r.number)).toEqual(["INV-0001", "INV-0001"]);
    expect((await org.collection("issuedNumbers").get()).size).toBe(1);
    expect(c.mailer.sent).toHaveLength(1);
  }, 20_000);
});

describe("what issuing refuses", () => {
  test("an org without one-off invoicing", async () => {
    const c = setup();
    const { uid, orgId, draftId } = await aDraft({ feature: false });
    await expect(issue(c, uid, orgId, draftId)).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("someone who is not the owner", async () => {
    const c = setup();
    const { orgId, draftId } = await aDraft();
    await expect(issue(c, await newUser(), orgId, draftId)).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("a draft with problems, in core's words; nothing is numbered and the draft stays", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft({ draft: { lines: [{ ...labour, quantityMilli: 0 }] } });
    await expect(issue(c, uid, orgId, draftId)).rejects.toMatchObject({ code: "invalid-argument", message: "Line 1: The quantity must be more than 0 and at most 1,000,000." });
    expect((await org.collection("private").doc("counter").get()).get("nextInvoiceNumber")).toBe(1);
    expect((await org.collection("drafts").doc(draftId).get()).exists).toBe(true);
    expect(c.mailer.sent).toEqual([]);
  });

  test("a customer who needs an order number, without one", async () => {
    const c = setup();
    const { uid, orgId, draftId } = await aDraft({ customer: { poRequired: true }, draft: { poNumber: "" } });
    await expect(issue(c, uid, orgId, draftId)).rejects.toMatchObject({ code: "invalid-argument", message: "This customer pays only against an order number. Enter it." });
  });

  test("a draft whose customer was deleted", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft();
    await org.collection("tenants").doc("c1").delete();
    await expect(issue(c, uid, orgId, draftId)).rejects.toMatchObject({ code: "invalid-argument", message: "Choose who this invoice is for." });
  });

  test("a draft that does not exist", async () => {
    const c = setup();
    const { uid, orgId } = await aDraft();
    await expect(issue(c, uid, orgId, "nope")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("a one-off is never caught up in a rent run", () => {
  test("issued while November's run awaits approval: approval numbers after it and leaves it alone", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, NOV, new Date("2026-10-28T00:00:00Z"));
    await issue(c, uid, orgId, draftId);
    const before = (await org.collection("invoices").doc(draftId).get()).data();
    await approveRun(orgId, NOV, { actor: uid, now });
    expect((await org.collection("invoices").doc("k1_2026-11").get()).get("number")).toBe("INV-0002");
    expect((await org.collection("invoices").doc(draftId).get()).data()).toEqual(before);
  });

  test("rebuild, PDF making and release for the month never touch it", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, NOV, new Date("2026-10-28T00:00:00Z"));
    await issue(c, uid, orgId, draftId);
    const before = (await org.collection("invoices").doc(draftId).get()).data();
    await rebuild(orgId, NOV);
    await approveRun(orgId, NOV, { actor: uid, now: new Date("2026-10-29T00:00:00Z") });
    await renderMissingPdfs(orgId, NOV);
    const released = await releaseRun(orgId, NOV, new Date("2026-11-20T00:00:00Z"));
    expect(released.released && released.invoices.map((i) => i.id)).toEqual(["k1_2026-11"]);
    expect((await org.collection("invoices").doc(draftId).get()).data()).toEqual(before);
  });
});

describe("after issuing, a one-off is tracked like any invoice", () => {
  test("it can be marked paid, and resent to the customer with their copy-to", async () => {
    const c = setup();
    const { uid, orgId, draftId, org } = await aDraft();
    await issue(c, uid, orgId, draftId);
    await c.resendInvoice.run(request(uid, { orgId, invoiceId: draftId }));
    expect(c.mailer.sent[1]).toMatchObject({ to: "accounts@kila.example", cc: ["boss@kila.example"] });
    await c.markPaid.run(request(uid, { orgId, invoiceId: draftId, note: "Transfer" }));
    expect((await org.collection("invoices").doc(draftId).get()).get("status")).toBe("paid");
  });
});
