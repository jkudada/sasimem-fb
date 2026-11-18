import { type CalendarDate, defaultPlan, newFreeSubscription, newTrialSubscription, type Period, type SubscriptionFields, toea } from "@sasimem/core";
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import type { ConsoleData } from "./data.js";
import { billingView, metricsView, paymentsCsv } from "./reports.js";
import { Billing } from "./screens/Billing.js";
import type { PaymentRow, SubscriberInput } from "./types.js";

const d = (x: string) => x as CalendarDate;
const now = new Date("2027-03-10T00:00:00Z"); // 10 March 2027, Port Moresby
const trial = newTrialSubscription({ plan: defaultPlan("standard"), today: d("2027-03-01"), referenceNumber: 7 });
const paid = (o: Partial<SubscriptionFields> = {}): SubscriptionFields => ({ ...trial, status: "active", trialEndsOn: d("2026-12-31"), paidThrough: d("2027-12-31"), ...o });
let n = 0;
const input = (sub: SubscriptionFields | null, o: Partial<SubscriberInput> = {}): SubscriberInput => {
  n++;
  return { org: { id: `o${n}`, name: `Org ${n}`, email: `o${n}@x.example`, createdAt: null }, sub, runs: [], emails: [], ...o };
};
const payment = (o: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "p", orgId: "o1", orgName: "Wari Holdings", subscriptionReference: "SUB-0007", amountToea: 40_000,
  receivedOn: d("2027-03-02"), bankReference: "BSP 123", coversFrom: d("2027-04-01"), coversTo: d("2028-03-31"), ...o,
});

describe("metrics (PLAN-SUBSCRIBERS §7)", () => {
  test("annual recurring revenue counts active and past-due subscriptions at their locked price, annualised; trials and free count zero", () => {
    const m = metricsView([
      input(paid()), // K400 a year
      input(paid({ interval: "monthly", priceToea: toea(10_000), planId: "plus" })), // K100 a month: K1,200
      input(paid({ paidThrough: d("2027-03-01") })), // past due: still counted
      input(paid({ paidThrough: d("2027-01-31") })), // restricted: not counted
      input(trial),
      input(newFreeSubscription({ plan: defaultPlan("free"), activeTenancyCount: 1 })),
      input(null),
    ], now);
    expect(m.annualRevenueToea).toBe(40_000 + 120_000 + 40_000);
    expect(m.byPlan.standard).toEqual({ active: 1, past_due: 1, restricted: 1, trial: 1 });
    expect(m.byPlan.plus).toEqual({ active: 1 });
    expect(m.byPlan.free).toEqual({ free: 1 });
  });

  test("trial conversion counts ended trials that paid; churn and invoices sent are by month", () => {
    const m = metricsView([
      input(paid(), { runs: [{ period: "2027-02", status: "sent", approvedAt: null, invoiceCount: 4, totalToea: 1 }, { period: "2027-03", status: "held", approvedAt: null, invoiceCount: 9, totalToea: 1 }] }),
      input({ ...trial, trialEndsOn: d("2027-02-28"), status: "cancelled", cancelledOn: d("2027-03-02"), purgeAfter: d("2027-05-31") }),
    ], now);
    expect(m.trials).toEqual({ ended: 2, paid: 1 });
    expect(m.months).toHaveLength(12);
    expect(m.months.at(-1)).toEqual({ period: "2027-03", cancelled: 1, invoicesSent: 0 });
    expect(m.months.at(-2)).toEqual({ period: "2027-02", cancelled: 0, invoicesSent: 4 });
  });
});

describe("billing (PLAN-SUBSCRIBERS §7)", () => {
  test("renewals within 30 days, overdue by how long, and this month's payments", () => {
    const soon = input(paid({ paidThrough: d("2027-04-05") }));
    const later = input(paid({ paidThrough: d("2027-06-30") }));
    const overdue = input(paid({ paidThrough: d("2027-03-01") }));
    const byHand = input(paid({ manuallyRestricted: true }));
    const b = billingView([soon, later, overdue, byHand], [payment(), payment({ id: "q", receivedOn: d("2027-02-27") })], now);
    expect(b.renewals.map((r) => [r.orgId, r.date])).toEqual([[soon.org.id, "2027-04-05"]]);
    expect(b.overdue.map((r) => [r.orgId, r.status, r.date])).toEqual([[overdue.org.id, "past_due", "2027-03-01"]]);
    expect(b.paymentsThisMonth.map((p) => p.id)).toEqual(["p"]);
    expect(b.receivedThisMonthToea).toBe(40_000);
  });

  test("the CSV lists payments with date, org, amount, bank reference and period covered, oldest first, safe for a spreadsheet", () => {
    const csv = paymentsCsv([
      payment({ receivedOn: d("2027-03-02") }),
      payment({ receivedOn: d("2027-02-27"), orgName: "=Kila, \"Trading\"", bankReference: "BSP 9", amountToea: 12_005 }),
      payment({ receivedOn: d("2027-01-15") }),
    ], "2027-02" as Period, "2027-03" as Period);
    expect(csv.split("\r\n")).toEqual([
      "Received on,Organisation,Amount (K),Bank reference,Subscription reference,Covers from,Covers to",
      "2027-02-27,\"'=Kila, \"\"Trading\"\"\",120.05,BSP 9,SUB-0007,2027-04-01,2028-03-31",
      "2027-03-02,Wari Holdings,400.00,BSP 123,SUB-0007,2027-04-01,2028-03-31",
      "",
    ]);
  });

  test("the page downloads the CSV for the months chosen", async () => {
    const save = vi.fn();
    const data = { subscribers: vi.fn(async () => []), payments: vi.fn(async () => [payment()]) } as unknown as ConsoleData;
    render(<Billing data={async () => data} now={() => now} save={save} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download CSV" }));
    expect(save).toHaveBeenCalledWith("sasimem-payments-2027-03-to-2027-03.csv", expect.stringContaining("Wari Holdings,400.00"));
  });
});
