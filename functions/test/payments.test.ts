import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makePaymentCallables } from "../src/callables/payments.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { aSentMonth, anOrgWith } from "./harness/seed.js";
import { draftRun } from "../src/store/runs.js";
import { parsePeriod } from "@sasimem/core";

const monday = new Date("2026-10-12T01:00:00Z");
const tuesday = new Date("2026-10-13T01:00:00Z");

function setup(at = monday) {
  let now = at;
  const mailer = new FakeMailer();
  const callables = makePaymentCallables({ now: () => now, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example" });
  return { ...callables, mailer, at: (d: Date) => (now = d) };
}
const invoice = (orgId: string) => adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`);
const events = async (orgId: string) => (await adminDb().collection(`orgs/${orgId}/events`).where("kind", "!=", "runApproved").get()).docs.map((d) => d.data());

describe("paid ticks (plan §3.5)", () => {
  test("marking a sent invoice paid records when and the note, writes an event, and emails nobody", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await c.markPaid.run(request(uid, { orgId, invoiceId: "k1_2026-10", note: "Cash at the office" }));
    expect((await invoice(orgId).get()).data()).toMatchObject({ status: "paid", paidAt: Timestamp.fromDate(monday), paidNote: "Cash at the office" });
    expect(await events(orgId)).toEqual([{ actor: uid, kind: "invoicePaid", at: Timestamp.fromDate(monday), target: "invoices/k1_2026-10", note: "Cash at the office" }]);
    expect(c.mailer.sent).toEqual([]);
  });

  test("marking it paid again keeps the first date", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await c.markPaid.run(request(uid, { orgId, invoiceId: "k1_2026-10" }));
    c.at(tuesday);
    await c.markPaid.run(request(uid, { orgId, invoiceId: "k1_2026-10" }));
    expect((await invoice(orgId).get()).get("paidAt")).toEqual(Timestamp.fromDate(monday));
  });

  test("only a sent invoice can be marked paid", async () => {
    const c = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, parsePeriod("2026-10"), monday);
    await expect(c.markPaid.run(request(uid, { orgId, invoiceId: "k1_2026-10" }))).rejects.toMatchObject({ code: "failed-precondition", message: "Only an invoice that has been sent can be marked paid." });
  });

  test("a long note is refused with core's message", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await expect(c.markPaid.run(request(uid, { orgId, invoiceId: "k1_2026-10", note: "x".repeat(201) }))).rejects.toMatchObject({ code: "invalid-argument", message: "Keep the note under 200 characters." });
  });

  test("not paid after all: back to sent, the date cleared, a reminder already sent stays recorded", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await invoice(orgId).update({ remindedAt: Timestamp.fromDate(monday) });
    await c.markPaid.run(request(uid, { orgId, invoiceId: "k1_2026-10", note: "cash" }));
    await c.markUnpaid.run(request(uid, { orgId, invoiceId: "k1_2026-10" }));
    expect((await invoice(orgId).get()).data()).toMatchObject({ status: "sent", paidAt: null, paidNote: "", remindedAt: Timestamp.fromDate(monday) });
  });

  test("a stranger can do none of it", async () => {
    const c = setup();
    const { orgId } = await aSentMonth();
    const stranger = await newUser();
    for (const fn of [c.markPaid, c.markUnpaid, c.pauseReminders, c.voidInvoice, c.invoicePdf, c.resendInvoice]) {
      await expect(fn.run(request(stranger, { orgId, invoiceId: "k1_2026-10", paused: true, reason: "x" }))).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
});

describe("the reminder switch", () => {
  test("pauses and resumes an invoice's reminder", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await c.pauseReminders.run(request(uid, { orgId, invoiceId: "k1_2026-10", paused: true }));
    expect((await invoice(orgId).get()).get("remindersPaused")).toBe(true);
    await c.pauseReminders.run(request(uid, { orgId, invoiceId: "k1_2026-10", paused: false }));
    expect((await invoice(orgId).get()).get("remindersPaused")).toBe(false);
  });
});

describe("void (owner only, audited)", () => {
  test("a sent invoice becomes void with the reason, by whom and when; its number stays issued", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await c.voidInvoice.run(request(uid, { orgId, invoiceId: "k1_2026-10", reason: "Tenant left in September" }));
    expect((await invoice(orgId).get()).data()).toMatchObject({ status: "void", voidReason: "Tenant left in September", voidedAt: Timestamp.fromDate(monday), number: "INV-0001" });
    expect((await adminDb().doc(`orgs/${orgId}/issuedNumbers/1`).get()).exists).toBe(true);
    expect(await events(orgId)).toEqual([{ actor: uid, kind: "invoiceVoided", at: Timestamp.fromDate(monday), target: "invoices/k1_2026-10", note: "Tenant left in September" }]);
  });

  test("a draft is refused - leave it out instead - and a reason is required", async () => {
    const c = setup();
    const draft = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(draft.orgId, parsePeriod("2026-10"), monday);
    await expect(c.voidInvoice.run(request(draft.uid, { orgId: draft.orgId, invoiceId: "k1_2026-10", reason: "x" }))).rejects.toMatchObject({ message: "A draft is not voided: leave it out of the month instead." });
    const sent = await aSentMonth();
    await expect(c.voidInvoice.run(request(sent.uid, { orgId: sent.orgId, invoiceId: "k1_2026-10", reason: " " }))).rejects.toMatchObject({ code: "invalid-argument", message: "Say why this invoice is void." });
  });
});

describe("a void invoice goes nowhere", () => {
  test("voided after approval, it is not sent at release; voided after sending, it is never reminded", async () => {
    const { runTick } = await import("../src/tick.js");
    const { approveRun } = await import("../src/store/approval.js");
    const { renderMissingPdfs } = await import("../src/store/pdfs.js");
    const c = setup(new Date("2026-09-29T00:00:00Z"));
    const a = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(a.orgId, parsePeriod("2026-10"), monday);
    await approveRun(a.orgId, parsePeriod("2026-10"), { actor: "uid", now: monday });
    await renderMissingPdfs(a.orgId, parsePeriod("2026-10"));
    await c.voidInvoice.run(request(a.uid, { orgId: a.orgId, invoiceId: "k1_2026-10", reason: "Wrong tenant" }));
    const mailer = new FakeMailer();
    const tick = (at: string, orgId: string) => runTick({ now: () => new Date(at), mailer, newToken: tokens().next, appUrl: () => "https://x.example" }, { orgIds: [orgId] });
    await tick("2026-09-30T22:00:00Z", a.orgId);
    expect(mailer.to("k1@tenant.example")).toEqual([]);

    const b = await aSentMonth();
    await c.voidInvoice.run(request(b.uid, { orgId: b.orgId, invoiceId: "k1_2026-10", reason: "Moved out" }));
    expect((await tick("2026-10-20T00:00:00Z", b.orgId)).reminded).toBe(0);
  });
});

describe("the PDF", () => {
  test("an owner gets the invoice's own frozen PDF, named by its number", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    const { filename, base64 } = await c.invoicePdf.run(request(uid, { orgId, invoiceId: "k1_2026-10" }));
    expect(filename).toBe("INV-0001.pdf");
    const [stored] = await (await import("../src/admin.js")).bucket().file(`invoices/${orgId}/k1_2026-10.pdf`).download();
    expect(Buffer.from(base64, "base64").equals(stored)).toBe(true);
  });

  test("an invoice not yet approved has no PDF to link to", async () => {
    const c = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, parsePeriod("2026-10"), monday);
    await expect(c.invoicePdf.run(request(uid, { orgId, invoiceId: "k1_2026-10" }))).rejects.toMatchObject({ code: "failed-precondition", message: "This invoice has no PDF yet." });
  });
});

describe("email again", () => {
  test("emails the tenant the same invoice and PDF again, logged, as often as the landlord asks", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await c.resendInvoice.run(request(uid, { orgId, invoiceId: "k1_2026-10" }));
    const reply = await c.resendInvoice.run(request(uid, { orgId, invoiceId: "k1_2026-10" }));
    expect(reply.message).toBe("Emailed INV-0001 to k1@tenant.example again.");
    expect(c.mailer.to("k1@tenant.example")).toHaveLength(2);
    expect(c.mailer.sent[0]?.attachments?.[0]?.filename).toBe("INV-0001.pdf");
    expect(c.mailer.sent[0]?.idempotencyKey).toBeUndefined();
    const log = (await adminDb().collection(`orgs/${orgId}/emails`).where("kind", "==", "tenantInvoiceAgain").get()).size;
    expect(log).toBe(2);
  });

  test("the provider refusing it is a clear error, not INTERNAL", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    c.mailer.refusing = true;
    await expect(c.resendInvoice.run(request(uid, { orgId, invoiceId: "k1_2026-10" }))).rejects.toMatchObject({
      code: "aborted", message: "The email could not be sent. Try again in a few minutes.",
    });
  });

  test("an invoice not yet sent, or void, cannot be emailed again", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await c.voidInvoice.run(request(uid, { orgId, invoiceId: "k1_2026-10", reason: "Moved out" }));
    await expect(c.resendInvoice.run(request(uid, { orgId, invoiceId: "k1_2026-10" }))).rejects.toMatchObject({ code: "failed-precondition" });
  });
});

describe("the CSV export", () => {
  test("the issued invoices in the range, by number, a void one marked, and drafts left out", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth({ tenancies: [{ id: "k1", tenantName: "Peter Kila" }, { id: "k2", tenantName: "Anna Bale" }] });
    await c.markPaid.run(request(uid, { orgId, invoiceId: "k1_2026-10", note: "cash" }));
    await c.voidInvoice.run(request(uid, { orgId, invoiceId: "k2_2026-10", reason: "Moved out" }));
    await draftRun(orgId, parsePeriod("2026-11"), monday);
    const { filename, csv } = await c.exportCsv.run(request(uid, { orgId, from: "2026-01", to: "2026-12" }));
    expect(filename).toBe("invoices-2026-01-to-2026-12.csv");
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4); // header, two invoices, the final newline
    expect(lines[1]).toBe("INV-0001,2026-10-01,2026-10-08,2026-10,Anna Bale,Flat k2,K2-OCT26,1200.00,0.00,1200.00,Void,,,Moved out");
    expect(lines[2]).toBe("INV-0002,2026-10-01,2026-10-08,2026-10,Peter Kila,Flat k1,K1-OCT26,1200.00,0.00,1200.00,Paid,2026-10-12,cash,");
  });

  test("a range backwards or over 24 months is refused with core's message", async () => {
    const c = setup();
    const { uid, orgId } = await aSentMonth();
    await expect(c.exportCsv.run(request(uid, { orgId, from: "2026-12", to: "2026-01" }))).rejects.toMatchObject({ code: "invalid-argument", message: "The first month must come before the last." });
    await expect(c.exportCsv.run(request(await newUser(), { orgId, from: "2026-01", to: "2026-12" }))).rejects.toMatchObject({ code: "permission-denied" });
  });
});
