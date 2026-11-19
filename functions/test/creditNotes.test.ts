/**
 * G2c (docs/test-lists/general-g2.md): credit notes, and using credit. A credit note comes
 * off an invoice's balance first, the rest is the customer's credit; payments use credit.
 */
import { describe, expect, test } from "vitest";
import { makeCreditNoteCallables } from "../src/callables/creditNotes.js";
import { makeOneOffCallables } from "../src/callables/oneoff.js";
import { makePaymentCallables } from "../src/callables/payments.js";
import { makeReceiptCallables } from "../src/callables/receipts.js";
import type { StoredCreditNote } from "../src/store/creditNotes.js";
import { renderCreditNotePdf } from "../src/store/pdfs.js";
import { runTick } from "../src/tick.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { pdfText } from "./harness/pdf-text.js";
import { RACE_TIMEOUT_MS as RACE } from "./harness/race.js";
import { anOrgWith } from "./harness/seed.js";

const now = new Date("2026-11-19T01:00:00Z"); // 19 November in Port Moresby
const line = (priceToea: number, description = "Work") => ({ description, detail: "", quantityMilli: 1000, unit: "", unitPriceToea: priceToea, taxCode: "standard" });

function setup() {
  const mailer = new FakeMailer();
  const deps = { now: () => now, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example" };
  return { ...makeOneOffCallables(deps), ...makePaymentCallables(deps), ...makeReceiptCallables(deps), ...makeCreditNoteCallables(deps), mailer, deps };
}

/** An org with one-off invoices on and one invoice issued to Kila Trading (copy-to boss@), of these lines. Not GST-registered unless asked. */
async function anInvoice(lines: ReturnType<typeof line>[], opts: { gst?: boolean; feature?: boolean } = {}) {
  const c = setup();
  const seeded = await anOrgWith({ tenancies: [] });
  const org = adminDb().doc(`orgs/${seeded.orgId}`);
  await org.update({ features: { rentals: true, repeating: true, oneOff: true }, ...(opts.gst === true ? { gstRegistered: true, gstNumber: "500012345" } : {}) });
  await org.collection("tenants").doc("c1").set({ name: "Kila Trading", email: "accounts@kila.example", phone: "", ccEmails: ["boss@kila.example"] });
  await org.collection("drafts").doc("d1").set({ customerId: "c1", lines, poNumber: "", notes: "", dueDays: 14 });
  await c.issueInvoice.run(request(seeded.uid, { orgId: seeded.orgId, draftId: "d1" }));
  if (opts.feature === false) await org.update({ features: { rentals: true, repeating: true, oneOff: false } });
  c.mailer.sent.length = 0;
  return { ...seeded, org, c };
}
type O = Awaited<ReturnType<typeof anInvoice>>;

let n = 0;
const cnId = () => `cn${Date.now()}${n++}`;
const issue = (o: O, data: Record<string, unknown>) =>
  o.c.issueCreditNote.run(request(o.uid, { orgId: o.orgId, creditNoteId: cnId(), invoiceId: "d1", reason: "Returned goods", emailIt: true, ...data }));
const pay = (o: O, data: Record<string, unknown>) => o.c.recordPayment.run(request(o.uid, {
  orgId: o.orgId, paymentId: `p${Date.now()}${n++}`, customerId: "c1", receivedOn: "2026-11-19", amountToea: 0, method: "bank", reference: "", note: "",
  allocations: [], emailReceipt: true, ...data,
}));
const invoice = async (o: O) => (await o.org.collection("invoices").doc("d1").get()).data() ?? {};
const credit = async (o: O) => (await o.org.collection("credits").doc("c1").get()).get("balanceToea") ?? 0;

describe("issuing a credit note", () => {
  test("numbers it, freezes it, records the event, takes it off the balance, makes the PDF, and emails it to the customer and copy-to", { timeout: 20_000 }, async () => {
    const o = await anInvoice([line(10_000), line(5_000, "Parts")]); // K150.00, no GST
    const id = cnId();
    expect(await issue(o, { creditNoteId: id, lines: [{ lineIndex: 1, amountToea: 2_000 }] })).toEqual({
      number: "CN-0001", message: "Issued CN-0001 for INV-0001, crediting Kila Trading. Emailed to accounts@kila.example.",
    });
    const cn = (await o.org.collection("creditNotes").doc(id).get()).data() as StoredCreditNote;
    expect(cn).toMatchObject({
      invoiceId: "d1", invoiceNumber: "INV-0001", customerId: "c1", customerName: "Kila Trading", number: "CN-0001", numberSeq: 1,
      documentTitle: "CREDIT NOTE", issueDate: "2026-11-19", reason: "Returned goods", totalToea: 2_000, appliedToea: 2_000, creditToea: 0, balanceAfterToea: 13_000,
      lines: [{ description: "Parts", amountToea: 2_000, gstToea: 0 }], pdfPath: `creditNotes/${o.orgId}/${id}.pdf`,
    });
    expect(cn.snapshot.tenantName).toBe("Kila Trading");
    expect(await invoice(o)).toMatchObject({ status: "sent", creditedToea: 2_000, creditNotedToea: 2_000, creditNotedLines: [{ amountToea: 0, gstToea: 0 }, { amountToea: 2_000, gstToea: 0 }] });
    expect(await credit(o)).toBe(0);
    expect((await o.org.collection("private").doc("counter").get()).data()).toMatchObject({ nextCreditNoteNumber: 2, nextInvoiceNumber: 2 });
    expect((await o.org.collection("events").where("kind", "==", "creditNoteIssued").get()).docs.map((d) => d.get("note"))).toEqual(["CN-0001 for INV-0001, K20.00: Returned goods"]);

    const [mail] = o.c.mailer.sent;
    expect(mail).toMatchObject({ to: "accounts@kila.example", cc: ["boss@kila.example"], subject: "Credit note CN-0001 from Wari Holdings - K20.00 off invoice INV-0001" });
    expect(mail?.attachments?.[0]?.filename).toBe("CN-0001.pdf");
    for (const s of ["credit note CN-0001 for invoice INV-0001", "Returned goods", "Taken off invoice INV-0001", "K130.00"]) expect(mail?.text).toContain(s);
    expect((await o.org.collection("emails").where("kind", "==", "creditNote").get()).docs[0]?.get("creditNoteId")).toBe(id);

    // The next is CN-0002; the rest of the invoice makes it paid.
    const rest = await issue(o, { emailIt: false, lines: [{ lineIndex: 0, amountToea: 10_000 }, { lineIndex: 1, amountToea: 3_000 }] });
    expect(rest).toEqual({ number: "CN-0002", message: "Issued CN-0002 for INV-0001, crediting Kila Trading." });
    expect(await invoice(o)).toMatchObject({ status: "paid", creditedToea: 15_000, creditNotedToea: 15_000, paidNote: "Credit note CN-0002" });
    expect(o.c.mailer.sent).toHaveLength(1);
  });

  test("crediting a paid invoice is the customer's credit; a payment can use it, with no receipt when nothing is received", { timeout: 20_000 }, async () => {
    const o = await anInvoice([line(10_000)]);
    await pay(o, { amountToea: 10_000, allocations: [{ invoiceId: "d1", amountToea: 10_000 }], emailReceipt: false });
    await issue(o, { emailIt: false, lines: [{ lineIndex: 0, amountToea: 4_000 }] });
    expect(await invoice(o)).toMatchObject({ status: "paid", creditedToea: 0, creditNotedToea: 4_000 });
    expect(await credit(o)).toBe(4_000);

    // A second invoice, paid K10 in cash and K40 of credit.
    await o.org.collection("drafts").doc("d2").set({ customerId: "c1", lines: [line(5_000)], poNumber: "", notes: "", dueDays: 14 });
    await o.c.issueInvoice.run(request(o.uid, { orgId: o.orgId, draftId: "d2" }));
    o.c.mailer.sent.length = 0;
    expect(await pay(o, { amountToea: 1_000, creditUsedToea: 4_000, allocations: [{ invoiceId: "d2", amountToea: 5_000 }] })).toEqual({
      receiptNumber: "RCT-0002", message: "Recorded K10.00 and K40.00 of their credit from Kila Trading: receipt RCT-0002. Emailed to accounts@kila.example.",
    });
    expect(o.c.mailer.sent[0]?.text).toContain("K40.00 of your credit was used as well.");
    expect(await credit(o)).toBe(0);
    expect((await o.org.collection("invoices").doc("d2").get()).data()).toMatchObject({ status: "paid", amountPaidToea: 5_000 });

    // More credit than they have is refused, in the transaction.
    await expect(pay(o, { amountToea: 0, creditUsedToea: 1, allocations: [] })).rejects.toMatchObject({ code: "invalid-argument", message: "They have no credit to use." });
  });

  test("a payment of credit only has no receipt number and sends nothing", { timeout: 20_000 }, async () => {
    const o = await anInvoice([line(10_000)]);
    await pay(o, { amountToea: 12_500, allocations: [{ invoiceId: "d1", amountToea: 2_000 }], emailReceipt: false }); // K105.00 credit
    o.c.mailer.sent.length = 0;
    expect(await pay(o, { amountToea: 0, creditUsedToea: 8_000, allocations: [{ invoiceId: "d1", amountToea: 8_000 }] })).toEqual({
      receiptNumber: "", message: "Used K80.00 of Kila Trading's credit. No money was received, so there is no receipt.",
    });
    expect(o.c.mailer.sent).toEqual([]);
    expect(await credit(o)).toBe(2_500);
    expect(await invoice(o)).toMatchObject({ status: "paid", amountPaidToea: 10_000, paidNote: "Credit" });
    expect((await o.org.collection("private").doc("counter").get()).get("nextReceiptNumber")).toBe(2);
  });

  test("undoing a payment gives back the credit it used and takes back what it made; refused when that credit was used", { timeout: 20_000 }, async () => {
    const o = await anInvoice([line(10_000)]);
    const made = `p${n++}`;
    await pay(o, { paymentId: made, amountToea: 15_000, allocations: [{ invoiceId: "d1", amountToea: 10_000 }], emailReceipt: false }); // K50.00 credit
    await o.org.collection("drafts").doc("d2").set({ customerId: "c1", lines: [line(5_000)], poNumber: "", notes: "", dueDays: 14 });
    await o.c.issueInvoice.run(request(o.uid, { orgId: o.orgId, draftId: "d2" }));
    const used = `p${n++}`;
    await pay(o, { paymentId: used, amountToea: 0, creditUsedToea: 3_000, allocations: [{ invoiceId: "d2", amountToea: 3_000 }] });
    expect(await credit(o)).toBe(2_000);

    const undo = (paymentId: string) => o.c.undoPayment.run(request(o.uid, { orgId: o.orgId, paymentId, reason: "Wrong" }));
    await expect(undo(made)).rejects.toMatchObject({
      code: "failed-precondition", message: "K50.00 of credit came from this payment, and some of it has been used since. Undo the payment that used it first.",
    });
    await undo(used);
    expect(await credit(o)).toBe(5_000);
    expect((await o.org.collection("invoices").doc("d2").get()).data()).toMatchObject({ status: "sent", amountPaidToea: 0 });
    await undo(made);
    expect(await credit(o)).toBe(0);
    expect(await invoice(o)).toMatchObject({ status: "sent", amountPaidToea: 0 });
  });

  test("a tax invoice gets a TAX CREDIT NOTE; the PDF prints the invoice it credits and the reason", { timeout: 20_000 }, async () => {
    const o = await anInvoice([line(10_000)], { gst: true }); // K100.00 + K10.00 GST
    const id = cnId();
    await issue(o, { creditNoteId: id, emailIt: false, reason: "Price agreed was lower", lines: [{ lineIndex: 0, amountToea: 1_000 }] });
    const cn = (await o.org.collection("creditNotes").doc(id).get()).data() as StoredCreditNote;
    expect(cn).toMatchObject({ documentTitle: "TAX CREDIT NOTE", subtotalToea: 1_000, gstToea: 100, totalToea: 1_100 });
    const text = pdfText(await renderCreditNotePdf(cn, null, { compress: false })).join("\n");
    for (const s of ["TAX CREDIT NOTE", "CN-0001", "For invoice", "INV-0001", "Price agreed was lower", "Taken off what you owe on INV-0001", "K11.00"]) expect(text, s).toContain(s);
    expect((await o.c.creditNotePdf.run(request(o.uid, { orgId: o.orgId, creditNoteId: id }))).filename).toBe("CN-0001.pdf");
    expect((await o.c.resendCreditNote.run(request(o.uid, { orgId: o.orgId, creditNoteId: id }))).message).toBe("Emailed CN-0001 to accounts@kila.example again.");
  });

  test("the same credit note ID twice gives one credit note, one number, one email", { timeout: RACE }, async () => {
    const o = await anInvoice([line(10_000)]);
    const id = cnId();
    const once = { creditNoteId: id, lines: [{ lineIndex: 0, amountToea: 1_000 }] };
    const [a, b] = await Promise.all([issue(o, once), issue(o, once)]);
    expect([a.number, b.number]).toEqual(["CN-0001", "CN-0001"]);
    expect(o.c.mailer.sent).toHaveLength(1);
    expect(await invoice(o)).toMatchObject({ creditedToea: 1_000 });
    expect((await o.org.collection("creditNotes").get()).size).toBe(1);
  });
});

describe("refused", () => {
  test("without oneOff, or for someone who is not the owner", { timeout: 20_000 }, async () => {
    const o = await anInvoice([line(10_000)], { feature: false });
    await expect(issue(o, { lines: [{ lineIndex: 0, amountToea: 1_000 }] })).rejects.toMatchObject({ code: "failed-precondition" });
    const stranger = await newUser();
    await expect(o.c.issueCreditNote.run(request(stranger, { orgId: o.orgId, creditNoteId: cnId(), invoiceId: "d1", reason: "x", lines: [] }))).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("a void invoice, more than is left (checked in the transaction), and no reason", { timeout: RACE }, async () => {
    const o = await anInvoice([line(10_000)]);
    await expect(issue(o, { reason: " ", lines: [{ lineIndex: 0, amountToea: 1_000 }] })).rejects.toMatchObject({ message: "Say why you are crediting this invoice. It prints on the credit note." });
    // Two at once, each within the line, together past it: one wins.
    const results = await Promise.allSettled([issue(o, { lines: [{ lineIndex: 0, amountToea: 6_000 }] }), issue(o, { lines: [{ lineIndex: 0, amountToea: 6_000 }] })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { message: 'Only K40.00 of "Work" is left to credit.' } });
    await o.org.collection("invoices").doc("d1").update({ status: "void" });
    await expect(issue(o, { lines: [{ lineIndex: 0, amountToea: 1_000 }] })).rejects.toMatchObject({ message: "Only a sent or paid invoice can be credited." });
  });

  test("mark paid, not paid and void, once an invoice has a credit note", { timeout: 20_000 }, async () => {
    const o = await anInvoice([line(10_000)]);
    await issue(o, { emailIt: false, lines: [{ lineIndex: 0, amountToea: 1_000 }] });
    const call = (name: "markPaid" | "voidInvoice", data: Record<string, unknown>) => o.c[name].run(request(o.uid, { orgId: o.orgId, invoiceId: "d1", ...data }));
    await expect(call("markPaid", { note: "" })).rejects.toMatchObject({ message: "This invoice has a credit note. Record the rest as a payment." });
    await expect(call("voidInvoice", { reason: "Wrong" })).rejects.toMatchObject({ message: "This invoice has a credit note, so it stays issued. Credit what is left instead." });
    await o.org.collection("invoices").doc("d1").update({ status: "paid" });
    await expect(o.c.markUnpaid.run(request(o.uid, { orgId: o.orgId, invoiceId: "d1" }))).rejects.toMatchObject({ message: "This invoice has a credit note, so what it owes follows its payments and credit notes." });
  });
});

test("a part-credited invoice's reminder asks for what is left", { timeout: 20_000 }, async () => {
  const o = await anInvoice([line(10_000)]);
  await issue(o, { emailIt: false, lines: [{ lineIndex: 0, amountToea: 3_000 }] });
  // Issued 19 November with 14 days to pay; 7 days after the due date is 10 December.
  expect((await runTick({ ...o.c.deps, now: () => new Date("2026-12-09T14:00:00Z") }, { orgIds: [o.orgId] })).reminded).toBe(1);
  const reminder = o.c.mailer.to("accounts@kila.example").at(-1);
  expect(reminder?.subject).toBe("Reminder: invoice INV-0001 from Wari Holdings - K70.00 was due 3 December 2026");
  expect(reminder?.text).toContain("After the credit of K30.00, K70.00 is still to pay.");
  expect(reminder?.text).toContain("Credited");
});
