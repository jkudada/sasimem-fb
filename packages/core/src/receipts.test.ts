import { describe, expect, test } from "vitest";
import { arrears, invoiceChip } from "./payments.js";
import type { CalendarDate, Period } from "./period.js";
import * as r from "./receipts.js";
import type { Toea } from "./money.js";

const today = "2026-11-19" as CalendarDate;
const k = (n: number) => n as Toea;

const inv = (over: Partial<r.OpenInvoice> = {}): r.OpenInvoice => ({
  id: "i1", number: "INV-0001", customerId: "c1", status: "sent", dueDate: "2026-11-01" as CalendarDate, totalToea: k(10_000), ...over,
});

const payment = (over: Partial<r.PaymentInput> = {}): r.PaymentInput => ({
  customerId: "c1", receivedOn: today, amountToea: k(10_000), method: "bank", reference: "TRF 991", note: "",
  allocations: [{ invoiceId: "i1", amountToea: k(10_000) }], ...over,
});

describe("paid so far and the balance", () => {
  test("from amountPaidToea", () => {
    expect(r.paidSoFar(inv({ amountPaidToea: k(4_000) }))).toBe(4_000);
    expect(r.balanceOf(inv({ amountPaidToea: k(4_000) }))).toBe(6_000);
    expect(r.balanceOf(inv())).toBe(10_000);
  });

  test("an invoice ticked paid before G2b, with no amount recorded, is paid in full", () => {
    expect(r.paidSoFar(inv({ status: "paid" }))).toBe(10_000);
    expect(r.balanceOf(inv({ status: "paid" }))).toBe(0);
  });

  test("void and unissued invoices owe nothing", () => {
    for (const status of ["void", "draft", "approved", "excluded"] as const) expect(r.balanceOf(inv({ status })), status).toBe(0);
  });
});

describe("oldest first", () => {
  const a = inv({ id: "a", number: "INV-0003", dueDate: "2026-10-01" as CalendarDate, totalToea: k(5_000) });
  const b = inv({ id: "b", number: "INV-0001", dueDate: "2026-11-01" as CalendarDate, totalToea: k(5_000), amountPaidToea: k(2_000) });
  const c = inv({ id: "c", number: "INV-0002", dueDate: "2026-11-01" as CalendarDate, totalToea: k(5_000) });

  test("by due date, then number; stops when the money runs out", () => {
    expect(r.oldestFirst(k(9_000), [c, b, a])).toEqual({ allocations: [{ invoiceId: "a", amountToea: 5_000 }, { invoiceId: "b", amountToea: 3_000 }, { invoiceId: "c", amountToea: 1_000 }], creditToea: 0 });
  });

  test("what is left over is credit; paid and other customers' invoices are skipped by the caller's list", () => {
    expect(r.oldestFirst(k(15_000), [a, b])).toEqual({ allocations: [{ invoiceId: "a", amountToea: 5_000 }, { invoiceId: "b", amountToea: 3_000 }], creditToea: 7_000 });
    expect(r.oldestFirst(k(1_000), [inv({ status: "paid" })])).toEqual({ allocations: [], creditToea: 1_000 });
  });
});

describe("what is wrong with a payment", () => {
  const open = [inv(), inv({ id: "i2", number: "INV-0002", totalToea: k(3_000) })];
  const problems = (over: Partial<r.PaymentInput>, list = open) => r.paymentProblems(payment(over), list, today);

  test("a sound payment, in full or part, with or without credit", () => {
    expect(problems({})).toEqual({});
    expect(problems({ amountToea: k(4_000), allocations: [{ invoiceId: "i1", amountToea: k(4_000) }] })).toEqual({});
    expect(problems({ amountToea: k(20_000) })).toEqual({});
    expect(problems({ allocations: [] })).toEqual({}); // all of it credit
  });

  test("the customer, date, amount, method, reference and note", () => {
    expect(problems({ customerId: "" }).customerId).toBe("Choose who paid.");
    expect(problems({ receivedOn: "2026-11-20" as CalendarDate }).receivedOn).toBe("A payment cannot be received in the future.");
    expect(problems({ receivedOn: "19/11/2026" as CalendarDate }).receivedOn).toBe("Enter the date it was received.");
    expect(problems({ amountToea: k(0), allocations: [] }).amountToea).toBe("Enter the amount received.");
    expect(problems({ amountToea: k(-100), allocations: [] }).amountToea).toBe("Enter the amount received.");
    expect(problems({ amountToea: k(1_000_000_001), allocations: [] }).amountToea).toBe("That is more than K10,000,000.00. Check the amount.");
    expect(problems({ amountToea: k(10.5) }).amountToea).toBe("Enter the amount received.");
    expect(problems({ method: "barter" as r.PaymentMethod }).method).toBe("Choose how it was paid.");
    expect(problems({ reference: "x".repeat(41) }).reference).toBe("Keep the reference to 40 characters or fewer.");
    expect(problems({ note: "x".repeat(201) }).note).toBe("Keep the note to 200 characters or fewer.");
  });

  test("allocations name open invoices of this customer, once each, within their balance", () => {
    const one = (invoiceId: string, amountToea: number) => problems({ allocations: [{ invoiceId, amountToea: k(amountToea) }] }).allocations;
    expect(one("nope", 100)).toBe("One of these invoices is no longer open for this customer. Reload and try again.");
    expect(problems({ allocations: [{ invoiceId: "x", amountToea: k(100) }] }, [inv({ id: "x", customerId: "c2" })]).allocations).toContain("no longer open for this customer");
    expect(problems({ allocations: [{ invoiceId: "x", amountToea: k(100) }] }, [inv({ id: "x", status: "paid" })]).allocations).toContain("no longer open for this customer");
    expect(one("i1", 0)).toBe("Each amount applied must be more than K0.00.");
    expect(one("i1", 10_001)).toBe("INV-0001 has only K100.00 left to pay.");
    expect(problems({ amountToea: k(13_000), allocations: [{ invoiceId: "i1", amountToea: k(100) }, { invoiceId: "i1", amountToea: k(100) }] }).allocations).toBe("INV-0001 is listed twice.");
    expect(problems({ amountToea: k(5_000), allocations: [{ invoiceId: "i1", amountToea: k(4_000) }, { invoiceId: "i2", amountToea: k(2_000) }] }).allocations)
      .toBe("You have applied K60.00, more than the K50.00 received.");
  });

  test("at most 20 invoices per payment", () => {
    const many = Array.from({ length: 21 }, (_, i) => inv({ id: `i${i}`, number: `INV-${i}`, totalToea: k(100) }));
    expect(r.paymentProblems(payment({ amountToea: k(2_100), allocations: many.map((m) => ({ invoiceId: m.id, amountToea: k(100) })) }), many, today).allocations)
      .toBe("A payment can be applied to up to 20 invoices.");
  });

  test("the credit is what is not applied", () => {
    expect(r.creditOf(payment({ amountToea: k(12_500) }))).toBe(2_500);
  });
});

describe("using credit (G2c)", () => {
  const open = [inv()];
  const problems = (p: Partial<r.PaymentInput>, credit = 0) => r.paymentProblems(payment(p), open, today, k(credit));

  test("up to the customer's credit, and no more than is applied", () => {
    expect(problems({ amountToea: k(7_500), creditUsedToea: k(2_500) }, 2_500)).toEqual({});
    expect(problems({ amountToea: k(7_500), creditUsedToea: k(2_500) }, 2_000).creditUsedToea).toBe("They have only K20.00 in credit.");
    expect(problems({ amountToea: k(7_500), creditUsedToea: k(2_500) }).creditUsedToea).toBe("They have no credit to use.");
    expect(problems({ amountToea: k(7_500), creditUsedToea: k(-1) }, 2_500).creditUsedToea).toBe("Enter how much credit to use.");
    expect(problems({ allocations: [{ invoiceId: "i1", amountToea: k(1_000) }], creditUsedToea: k(2_000) }, 2_500).creditUsedToea).toBe("Use no more credit than you apply to invoices.");
  });

  test("allocations up to what was received plus credit used", () => {
    expect(problems({ amountToea: k(5_000), creditUsedToea: k(2_500) }, 2_500).allocations).toBe("You have applied K100.00, more than the K50.00 received and K25.00 of credit.");
  });

  test("K0.00 received only when credit is used", () => {
    expect(problems({ amountToea: k(0), creditUsedToea: k(10_000) }, 10_000)).toEqual({});
    expect(problems({ amountToea: k(0), allocations: [] }).amountToea).toBe("Enter the amount received.");
  });

  test("the credit a payment makes counts the credit it used", () => {
    expect(r.creditOf(payment({ amountToea: k(5_000), creditUsedToea: k(5_000) }))).toBe(0);
    expect(r.creditOf(payment({ amountToea: k(8_000), creditUsedToea: k(5_000) }))).toBe(3_000);
  });
});

describe("applying a payment to an invoice, and undoing it", () => {
  test("part leaves it sent with a balance; the rest makes it paid", () => {
    expect(r.applied(inv(), k(4_000))).toEqual({ amountPaidToea: 4_000, status: "sent" });
    expect(r.applied(inv({ amountPaidToea: k(4_000) }), k(6_000))).toEqual({ amountPaidToea: 10_000, status: "paid" });
  });

  test("undoing reverses either", () => {
    expect(r.applied(inv({ status: "paid", amountPaidToea: k(10_000) }), k(-6_000))).toEqual({ amountPaidToea: 4_000, status: "sent" });
    expect(r.applied(inv({ amountPaidToea: k(4_000) }), k(-4_000))).toEqual({ amountPaidToea: 0, status: "sent" });
  });

  test("credit notes come off the balance and what can be paid (G2c)", () => {
    expect(r.balanceOf(inv({ amountPaidToea: k(4_000), creditedToea: k(1_000) }))).toBe(5_000);
    expect(r.applied(inv({ creditedToea: k(1_000) }), k(9_000))).toEqual({ amountPaidToea: 9_000, status: "paid" });
    expect(() => r.applied(inv({ creditedToea: k(1_000) }), k(9_001))).toThrow(RangeError);
  });

  test("never below 0 or above the total", () => {
    expect(() => r.applied(inv(), k(10_001))).toThrow(RangeError);
    expect(() => r.applied(inv(), k(-1))).toThrow(RangeError);
  });

  test("whether an invoice has payments recorded against it", () => {
    expect(r.hasPayments(inv({ amountPaidToea: k(1) }))).toBe(true);
    expect(r.hasPayments(inv({ status: "paid" }))).toBe(false); // ticked, not recorded
    expect(r.hasPayments(inv({ amountPaidToea: k(0) }))).toBe(false);
  });

  test("an undo needs a reason", () => {
    expect(r.undoReasonProblem(" ")).toBe("Say why this payment is being undone.");
    expect(r.undoReasonProblem("x".repeat(201))).toBe("Keep the reason to 200 characters or fewer.");
    expect(r.undoReasonProblem("Entered twice")).toBeNull();
  });
});

describe("the chip and arrears follow the balance", () => {
  test("Part paid before the due date, Overdue after, Paid at 0", () => {
    expect(invoiceChip({ status: "sent", dueDate: "2026-11-30" as CalendarDate, amountPaidToea: k(100) }, today)).toBe("Part paid");
    expect(invoiceChip({ status: "sent", dueDate: "2026-11-01" as CalendarDate, amountPaidToea: k(100) }, today)).toBe("Overdue");
    expect(invoiceChip({ status: "sent", dueDate: "2026-11-30" as CalendarDate }, today)).toBe("Not paid");
    expect(invoiceChip({ status: "paid", dueDate: "2026-11-30" as CalendarDate, amountPaidToea: k(100) }, today)).toBe("Paid");
  });

  test("arrears sum what is still owed", () => {
    const groups = arrears([
      { id: "a", tenantId: "c1", tenantName: "Kila", number: "INV-1", period: "2026-11" as Period, status: "sent", dueDate: "2026-11-01" as CalendarDate, totalToea: k(10_000), amountPaidToea: k(4_000) },
      { id: "b", tenantId: "c1", tenantName: "Kila", number: "INV-2", period: "2026-11" as Period, status: "sent", dueDate: "2026-11-02" as CalendarDate, totalToea: k(1_000) },
    ]);
    expect(groups[0]?.totalToea).toBe(7_000);
  });
});

test("the methods, in the owner's words", () => {
  expect(r.PAYMENT_METHODS.map((m) => r.METHOD_LABELS[m])).toEqual(["Bank transfer", "Cash", "Cheque", "Card (EFTPOS)", "Mobile money", "Other"]);
});
