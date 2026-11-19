/**
 * G2b (docs/test-lists/general-g2.md): part payments and receipts. A payment is applied to
 * a customer's open invoices in one transaction, numbered RCT-, and its receipt emailed.
 */
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeOneOffCallables } from "../src/callables/oneoff.js";
import { makePaymentCallables } from "../src/callables/payments.js";
import { makeReceiptCallables } from "../src/callables/receipts.js";
import { setNextInvoiceNumber } from "../src/callables/numbering.js";
import { runTick } from "../src/tick.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { RACE_TIMEOUT_MS } from "./harness/race.js";
import { anOrgWith } from "./harness/seed.js";

const now = new Date("2026-11-19T01:00:00Z"); // 19 November in Port Moresby
const line = (priceToea: number) => ({ description: "Work", detail: "", quantityMilli: 1000, unit: "", unitPriceToea: priceToea, taxCode: "standard" });

function setup(at: () => Date = () => now) {
  const mailer = new FakeMailer();
  const deps = { now: at, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example" };
  return { ...makeOneOffCallables(deps), ...makePaymentCallables(deps), ...makeReceiptCallables(deps), mailer, deps };
}

/** An org with one-off invoices on, a customer (with copy-to) and invoices of the given totals issued to them, oldest first. */
async function anOrgOwed(totals: number[], opts: { feature?: boolean; customer?: Record<string, unknown> } = {}) {
  const c = setup();
  const seeded = await anOrgWith({ tenancies: [] });
  const org = adminDb().doc(`orgs/${seeded.orgId}`);
  await org.update({ features: { rentals: true, repeating: true, oneOff: true } });
  await org.collection("tenants").doc("c1").set({ name: "Kila Trading", email: "accounts@kila.example", phone: "", ccEmails: ["boss@kila.example"], ...opts.customer });
  await org.collection("tenants").doc("c2").set({ name: "Mine Services", email: "ap@mine.example", phone: "" });
  const ids: string[] = [];
  for (const [n, total] of totals.entries()) {
    const draft = org.collection("drafts").doc(`d${n}`);
    await draft.set({ customerId: "c1", lines: [line(total)], poNumber: "", notes: "", dueDays: n });
    ids.push(draft.id);
  }
  return { ...seeded, org, ids, c };
}

/** Issue the drafts (separately, so seeding never needs the mailer to be quiet). */
async function issued(totals: number[], opts: Parameters<typeof anOrgOwed>[1] = {}) {
  const o = await anOrgOwed(totals, opts);
  for (const id of o.ids) await o.c.issueInvoice.run(request(o.uid, { orgId: o.orgId, draftId: id }));
  if (opts.feature === false) await o.org.update({ features: { rentals: true, repeating: true, oneOff: false } });
  o.c.mailer.sent.length = 0; // the invoices' own emails
  return o;
}

let n = 0;
const payment = (over: Record<string, unknown> = {}) => ({
  paymentId: `p${Date.now()}${n++}`, customerId: "c1", receivedOn: "2026-11-19", amountToea: 10_000, method: "bank", reference: "TRF 77", note: "",
  allocations: [] as { invoiceId: string; amountToea: number }[], emailReceipt: true, ...over,
});

type Owed = Awaited<ReturnType<typeof issued>>;
const record = (o: Owed, data: Record<string, unknown>) => o.c.recordPayment.run(request(o.uid, { orgId: o.orgId, ...data }));
const invoice = async (o: Owed, id: string) => (await o.org.collection("invoices").doc(id).get()).data() ?? {};
const stored = async (o: Owed, id: string) => (await o.org.collection("payments").doc(id).get()).data() ?? {};

describe("recording a payment", () => {
  test("applies it, updates each invoice, numbers the receipt, records the event, and emails the receipt to the customer and copy-to", { timeout: 20_000 }, async () => {
    const o = await issued([10_000, 5_000]); // not GST-registered: K100.00 and K50.00
    const [a, b] = o.ids as [string, string];
    const p = payment({ amountToea: 13_000, allocations: [{ invoiceId: a, amountToea: 10_000 }, { invoiceId: b, amountToea: 3_000 }] });
    expect(await record(o, p)).toEqual({ receiptNumber: "RCT-0001", message: "Recorded K130.00 from Kila Trading: receipt RCT-0001. Emailed to accounts@kila.example." });

    expect(await invoice(o, a)).toMatchObject({ status: "paid", amountPaidToea: 10_000, paidAt: Timestamp.fromDate(now), paidNote: "Receipt RCT-0001" });
    expect(await invoice(o, b)).toMatchObject({ status: "sent", amountPaidToea: 3_000, paidAt: null });
    expect(await stored(o, p.paymentId)).toMatchObject({
      customerId: "c1", customerName: "Kila Trading", receivedOn: "2026-11-19", amountToea: 13_000, method: "bank", reference: "TRF 77",
      allocations: [{ invoiceId: a, number: "INV-0001", amountToea: 10_000, balanceAfterToea: 0 }, { invoiceId: b, number: "INV-0002", amountToea: 3_000, balanceAfterToea: 2_000 }],
      creditToea: 0, receiptNumber: "RCT-0001", receiptSeq: 1, status: "recorded",
    });
    expect((await o.org.collection("private").doc("counter").get()).data()).toMatchObject({ nextReceiptNumber: 2, nextInvoiceNumber: 3 });
    expect((await o.org.collection("events").where("kind", "==", "paymentRecorded").get()).docs.map((d) => d.get("note"))).toEqual(["RCT-0001, K130.00, Kila Trading"]);

    const [mail] = o.c.mailer.sent;
    expect(mail).toMatchObject({ to: "accounts@kila.example", cc: ["boss@kila.example"], subject: "Receipt RCT-0001 from Wari Holdings - K130.00 received" });
    for (const s of ["Bank transfer", "TRF 77", "Invoice INV-0001", "K100.00 paid, now paid in full", "K30.00 paid, K20.00 still to pay"]) expect(mail?.text).toContain(s);
    expect((await o.org.collection("emails").where("kind", "==", "receipt").get()).docs[0]?.get("paymentId")).toBe(p.paymentId);
  });

  test("the next receipt is RCT-0002; an overpayment is kept as credit and the receipt says so", async () => {
    const o = await issued([10_000]);
    const [a] = o.ids as [string];
    await record(o, payment({ amountToea: 1_000, allocations: [{ invoiceId: a, amountToea: 1_000 }] }));
    const p = payment({ amountToea: 15_000, allocations: [{ invoiceId: a, amountToea: 9_000 }] });
    expect((await record(o, p)).receiptNumber).toBe("RCT-0002");
    expect(await stored(o, p.paymentId)).toMatchObject({ creditToea: 6_000 });
    expect(await invoice(o, a)).toMatchObject({ status: "paid", amountPaidToea: 10_000 });
    expect(o.c.mailer.sent[1]?.text).toContain("K60.00 was more than the invoices owed. Wari Holdings keeps it as credit for you.");
  });

  test("without Email a receipt nothing is sent", async () => {
    const o = await issued([10_000]);
    const res = await record(o, payment({ emailReceipt: false, amountToea: 1_000, allocations: [{ invoiceId: o.ids[0], amountToea: 1_000 }] }));
    expect(res.message).toBe("Recorded K10.00 from Kila Trading: receipt RCT-0001.");
    expect(o.c.mailer.sent).toEqual([]);
  });

  test("a refused email leaves the payment recorded and says so; Email receipt again sends it", async () => {
    const o = await issued([10_000]);
    o.c.mailer.refusing = true;
    const p = payment({ amountToea: 1_000, allocations: [{ invoiceId: o.ids[0], amountToea: 1_000 }] });
    expect((await record(o, p)).message).toContain("The receipt could not be emailed; try Email receipt again later.");
    expect(await stored(o, p.paymentId)).toMatchObject({ status: "recorded" });
    o.c.mailer.refusing = false;
    expect(await o.c.resendReceipt.run(request(o.uid, { orgId: o.orgId, paymentId: p.paymentId }))).toEqual({ ok: true, message: "Emailed receipt RCT-0001 to accounts@kila.example again." });
    expect(o.c.mailer.sent).toHaveLength(1);
  });

  test("the same payment ID twice gives one payment, one receipt number and one email", async () => {
    const o = await issued([10_000]);
    const p = payment({ amountToea: 1_000, allocations: [{ invoiceId: o.ids[0], amountToea: 1_000 }] });
    await record(o, p);
    expect((await record(o, p)).message).toBe("That payment was already recorded: receipt RCT-0001.");
    expect(await invoice(o, o.ids[0] as string)).toMatchObject({ amountPaidToea: 1_000 });
    expect(o.c.mailer.sent).toHaveLength(1);
  });

  test("two different payments at once cannot together pay more than an invoice's balance", { timeout: RACE_TIMEOUT_MS }, async () => {
    const o = await issued([10_000]);
    const each = () => payment({ amountToea: 8_000, allocations: [{ invoiceId: o.ids[0], amountToea: 8_000 }] });
    const results = await Promise.allSettled([record(o, each()), record(o, each())]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await invoice(o, o.ids[0] as string)).toMatchObject({ amountPaidToea: 8_000, status: "sent" });
  });
});

describe("what recording refuses", () => {
  test("an org without one-off invoicing, and someone who is not the owner", async () => {
    const off = await issued([10_000], { feature: false });
    await expect(record(off, payment())).rejects.toMatchObject({ code: "failed-precondition" });
    const o = await issued([10_000]);
    await expect(o.c.recordPayment.run(request(await newUser(), { orgId: o.orgId, ...payment() }))).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("another customer's invoice, more than the balance, a future date, in core's words", async () => {
    const o = await issued([10_000]);
    const a = o.ids[0] as string;
    await expect(record(o, payment({ customerId: "c2", allocations: [{ invoiceId: a, amountToea: 1_000 }] }))).rejects.toMatchObject({
      code: "invalid-argument", message: "One of these invoices is no longer open for this customer. Reload and try again.",
    });
    await expect(record(o, payment({ amountToea: 20_000, allocations: [{ invoiceId: a, amountToea: 10_001 }] }))).rejects.toMatchObject({ message: "INV-0001 has only K100.00 left to pay." });
    await expect(record(o, payment({ receivedOn: "2026-11-20" }))).rejects.toMatchObject({ message: "A payment cannot be received in the future." });
    expect((await o.org.collection("payments").get()).size).toBe(0);
  });

  test("a paid or void invoice is not open", async () => {
    const o = await issued([10_000, 10_000]);
    const [a, b] = o.ids as [string, string];
    await o.c.markPaid.run(request(o.uid, { orgId: o.orgId, invoiceId: a, note: "" }));
    await o.c.voidInvoice.run(request(o.uid, { orgId: o.orgId, invoiceId: b, reason: "Wrong customer" }));
    for (const id of [a, b]) await expect(record(o, payment({ allocations: [{ invoiceId: id, amountToea: 1_000 }] }))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  test("a payment it cannot read", async () => {
    const o = await issued([10_000]);
    for (const bad of [{ paymentId: "../x" }, { allocations: "all" }, { allocations: [{ invoiceId: "a/b", amountToea: 1 }] }, { reference: 7 }]) {
      await expect(record(o, payment(bad)), JSON.stringify(bad)).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });
});

describe("undoing a payment", () => {
  test("takes its allocations off, reopens a paid invoice, keeps the receipt number, emails nobody; twice is once", async () => {
    const o = await issued([10_000, 5_000]);
    const [a, b] = o.ids as [string, string];
    const p = payment({ amountToea: 13_000, allocations: [{ invoiceId: a, amountToea: 10_000 }, { invoiceId: b, amountToea: 3_000 }] });
    await record(o, p);
    o.c.mailer.sent.length = 0;
    const undo = () => o.c.undoPayment.run(request(o.uid, { orgId: o.orgId, paymentId: p.paymentId, reason: "Entered twice" }));
    expect(await undo()).toEqual({ ok: true, message: "Payment undone. Its invoices owe what they did before it." });
    expect(await invoice(o, a)).toMatchObject({ status: "sent", amountPaidToea: 0, paidAt: null, paidNote: "" });
    expect(await invoice(o, b)).toMatchObject({ status: "sent", amountPaidToea: 0 });
    expect(await stored(o, p.paymentId)).toMatchObject({ status: "undone", undoReason: "Entered twice", receiptNumber: "RCT-0001" });
    expect(await undo()).toEqual({ ok: true, message: "That payment was already undone." });
    expect(o.c.mailer.sent).toEqual([]);
    // The next receipt does not reuse the number.
    expect((await record(o, payment({ amountToea: 100, allocations: [] }))).receiptNumber).toBe("RCT-0002");
    await expect(o.c.resendReceipt.run(request(o.uid, { orgId: o.orgId, paymentId: p.paymentId }))).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("needs a reason", async () => {
    const o = await issued([10_000]);
    await expect(o.c.undoPayment.run(request(o.uid, { orgId: o.orgId, paymentId: "p1", reason: " " }))).rejects.toMatchObject({ message: "Say why this payment is being undone." });
  });
});

describe("while an invoice has payments recorded", () => {
  test("the paid tick, not paid and void are refused; with none they work as before", async () => {
    const o = await issued([10_000, 10_000]);
    const [a, b] = o.ids as [string, string];
    await record(o, payment({ amountToea: 1_000, allocations: [{ invoiceId: a, amountToea: 1_000 }] }));
    await expect(o.c.markPaid.run(request(o.uid, { orgId: o.orgId, invoiceId: a, note: "" }))).rejects.toMatchObject({ message: "This invoice has payments recorded. Record the rest as a payment." });
    await expect(o.c.voidInvoice.run(request(o.uid, { orgId: o.orgId, invoiceId: a, reason: "x" }))).rejects.toMatchObject({ message: "This invoice has payments recorded. Undo them first." });
    await record(o, payment({ amountToea: 9_000, allocations: [{ invoiceId: a, amountToea: 9_000 }] }));
    await expect(o.c.markUnpaid.run(request(o.uid, { orgId: o.orgId, invoiceId: a }))).rejects.toMatchObject({ message: "This invoice was paid by recorded payments. Undo the payment instead." });
    await o.c.markPaid.run(request(o.uid, { orgId: o.orgId, invoiceId: b, note: "Cash" }));
    expect(await invoice(o, b)).toMatchObject({ status: "paid" });
  });
});

test("a part-paid invoice's reminder asks for the balance", async () => {
  const o = await issued([10_000]);
  await record(o, payment({ emailReceipt: false, amountToea: 4_000, allocations: [{ invoiceId: o.ids[0], amountToea: 4_000 }] }));
  // Issued 19 November with 0 days to pay (d0); 7 days after is 26 November in Port Moresby.
  const at = new Date("2026-11-25T14:00:00Z");
  expect((await runTick({ ...o.c.deps, now: () => at }, { orgIds: [o.orgId] })).reminded).toBe(1);
  const reminder = o.c.mailer.to("accounts@kila.example").at(-1);
  expect(reminder?.subject).toBe("Reminder: invoice INV-0001 from Wari Holdings - K60.00 was due 19 November 2026");
  expect(reminder?.text).toContain("Thank you for the K40.00 paid so far; K60.00 is still to pay.");
  expect(reminder?.text).toContain("Paid so far");
});

test("setting the next invoice number keeps the receipt counter", async () => {
  const o = await anOrgOwed([]);
  await o.org.collection("private").doc("counter").set({ nextInvoiceNumber: 1, nextReceiptNumber: 7 });
  await setNextInvoiceNumber.run(request(o.uid, { orgId: o.orgId, next: 142 }));
  expect((await o.org.collection("private").doc("counter").get()).data()).toEqual({ nextInvoiceNumber: 142, nextReceiptNumber: 7 });
});
