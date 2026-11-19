import fc from "fast-check";
import { expect, test } from "vitest";
import type { Toea } from "./money.js";
import type { CalendarDate } from "./period.js";
import { type OpenInvoice, balanceOf, oldestFirst, paymentProblems } from "./receipts.js";

const invoices = fc.array(
  fc.record({
    totalToea: fc.integer({ min: 1, max: 100_000_000 }),
    paidShare: fc.double({ min: 0, max: 0.99, noNaN: true }),
    day: fc.integer({ min: 1, max: 28 }),
  }),
  { maxLength: 20 },
).map((xs) => xs.map((x, n): OpenInvoice => ({
  id: `i${n}`, number: `INV-${String(n).padStart(4, "0")}`, customerId: "c1", status: "sent",
  dueDate: `2026-10-${String(x.day).padStart(2, "0")}` as CalendarDate, totalToea: x.totalToea as Toea,
  amountPaidToea: Math.floor(x.totalToea * x.paidShare) as Toea,
})));

test("oldest first never takes an invoice below 0, and applied + credit = the amount received; the result is a valid payment", () => {
  fc.assert(fc.property(invoices, fc.integer({ min: 1, max: 1_000_000_000 }), (open, amount) => {
    const { allocations, creditToea } = oldestFirst(amount as Toea, open);
    for (const a of allocations) {
      const i = open.find((x) => x.id === a.invoiceId) as OpenInvoice;
      expect(a.amountToea).toBeGreaterThan(0);
      expect(a.amountToea).toBeLessThanOrEqual(balanceOf(i));
    }
    expect(allocations.reduce((t, a) => t + a.amountToea, 0) + creditToea).toBe(amount);
    expect(creditToea).toBeGreaterThanOrEqual(0);
    const payment = { customerId: "c1", receivedOn: "2026-11-19" as CalendarDate, amountToea: amount as Toea, method: "bank" as const, reference: "", note: "", allocations };
    expect(paymentProblems(payment, open, "2026-11-19" as CalendarDate)).toEqual({});
  }));
});
