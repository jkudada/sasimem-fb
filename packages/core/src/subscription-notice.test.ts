import { describe, expect, test } from "vitest";
import { toea } from "./money.js";
import type { CalendarDate } from "./period.js";
import * as n from "./subscription-notice.js";
import type { SubscriptionFields } from "./subscriptions.js";

const d = (x: string) => x as CalendarDate;
const sub = (o: Partial<SubscriptionFields> = {}): SubscriptionFields => ({
  planId: "standard", status: "trial", interval: "annual", priceToea: toea(40_000), tenancyLimit: 10, limitOverride: null,
  trialEndsOn: d("2026-11-30"), paidThrough: null, graceDays: 14, cancelledOn: null, purgeAfter: null,
  paymentReference: "SUB-0042", activeTenancyCount: 7, ...o,
});
const BANK: n.BankDetails = { accountName: "Sasimem Ltd", bankName: "BSP", accountNumber: "1001 2345 678", branch: "Waigani", contactEmail: "help@sasimem.example" };

describe("what is due (D3)", () => {
  test("annual is one year at the locked price; monthly is three months in advance", () => {
    expect(n.amountDue(sub())).toEqual({ amountToea: 40_000, covers: "a year", months: 12 });
    expect(n.amountDue(sub({ interval: "monthly", priceToea: toea(4_000) }))).toEqual({ amountToea: 12_000, covers: "three months", months: 3 });
  });

  test("how to pay names the amount, the bank account and the reference", () => {
    expect(n.howToPay(sub(), BANK)).toBe("Pay K400.00 for a year to Sasimem Ltd, BSP account 1001 2345 678 (Waigani), with the reference SUB-0042.");
    expect(n.howToPay(sub(), null)).toBe("Pay K400.00 for a year, with the reference SUB-0042. Ask Sasimem for the bank details.");
  });
});

describe("the banner (PLAN-SUBSCRIBERS §8)", () => {
  test("a trial says nothing until 14 days before its last day, then counts down", () => {
    expect(n.subscriptionNotice(sub(), d("2026-11-15"), BANK)).toBeNull();
    const first = n.subscriptionNotice(sub(), d("2026-11-16"), BANK);
    expect(first).toMatchObject({ kind: "trialEnding", tone: "warning", title: "Your free trial ends on 30 November 2026" });
    expect(first?.body).toContain("K400.00");
    expect(first?.body).toContain("SUB-0042");
    expect(first?.body).toContain("BSP account 1001 2345 678");
    expect(n.subscriptionNotice(sub(), d("2026-11-29"), BANK)?.title).toBe("Your free trial ends tomorrow");
    expect(n.subscriptionNotice(sub(), d("2026-11-30"), BANK)?.title).toBe("Your free trial ends today");
  });

  test("past due names the amount, the reference, and the day drafting stops", () => {
    const notice = n.subscriptionNotice(sub(), d("2026-12-05"), BANK);
    expect(notice).toMatchObject({ kind: "pastDue", tone: "warning", title: "Your Sasimem payment is overdue" });
    expect(notice?.body).toContain("K400.00");
    expect(notice?.body).toContain("SUB-0042");
    expect(notice?.body).toContain("From 15 December 2026, next month's invoices will not be drafted until payment arrives.");
    expect(notice?.body).toContain("Invoices already approved are sent as normal.");
  });

  test("restricted says plainly what stops and what carries on, and how to pay", () => {
    const notice = n.subscriptionNotice(sub(), d("2026-12-15"), BANK);
    expect(notice).toMatchObject({ kind: "restricted", tone: "problem", title: "Your Sasimem subscription is restricted" });
    expect(notice?.body).toContain("Next month's invoices will not be drafted until payment arrives. Invoices already approved are sent as normal.");
    expect(notice?.body).toContain("K400.00");
    expect(notice?.body).toContain("SUB-0042");
  });

  test("restricted by hand asks the landlord to contact Sasimem, not to pay", () => {
    const notice = n.subscriptionNotice(sub({ status: "active", paidThrough: d("2027-11-30"), manuallyRestricted: true }), d("2026-12-01"), BANK);
    expect(notice?.body).toBe("Next month's invoices will not be drafted until Sasimem lifts the restriction. Invoices already approved are sent as normal. Contact Sasimem at help@sasimem.example.");
  });

  test("cancelled says when the records go", () => {
    const notice = n.subscriptionNotice(sub({ status: "cancelled", cancelledOn: d("2026-12-01"), purgeAfter: d("2027-03-01") }), d("2026-12-02"), null);
    expect(notice).toMatchObject({ kind: "cancelled", tone: "problem" });
    expect(notice?.body).toBe("No new month will be drafted. Your records are kept, read-only, until 1 March 2027. Contact Sasimem.");
  });

  test("active and free say nothing", () => {
    expect(n.subscriptionNotice(sub({ status: "active", trialEndsOn: null, paidThrough: d("2027-11-30") }), d("2026-12-01"), BANK)).toBeNull();
    expect(n.subscriptionNotice(sub({ planId: "free", status: "free", trialEndsOn: null, paymentReference: null }), d("2026-12-01"), BANK)).toBeNull();
  });

  test("it follows the dates, not a stored status the daily tick has not caught up with", () => {
    expect(n.subscriptionNotice(sub({ status: "trial" }), d("2026-12-20"), BANK)?.kind).toBe("restricted");
  });
});

describe("drafting refused (D5)", () => {
  test("restricted and cancelled refuse with a plain reason; the rest draft", () => {
    expect(n.draftRefusal(sub(), "restricted")).toBe(
      "Your Sasimem subscription is restricted, so no new month can be drafted until payment arrives. Months already drafted carry on as normal. See Settings, Plan & billing.",
    );
    expect(n.draftRefusal(sub({ manuallyRestricted: true }), "restricted")).toContain("until Sasimem lifts the restriction");
    expect(n.draftRefusal(sub(), "cancelled")).toBe("Your Sasimem subscription is cancelled, so no new month can be drafted.");
    expect(n.draftRefusal(sub(), "purged")).not.toBeNull();
    for (const status of ["trial", "free", "active", "past_due"] as const) expect(n.draftRefusal(sub(), status)).toBeNull();
  });
});

describe("the limit (PLAN-SUBSCRIBERS §8)", () => {
  test("usage reads as 7 of 10 tenancies", () => {
    expect(n.usageText(sub())).toBe("7 of 10 tenancies");
  });

  test("at or over the limit, it says the limit, the count and what to do", () => {
    expect(n.limitText(sub({ activeTenancyCount: 10 }))).toBe(
      "On Standard you can have 10 tenancies at once, and you have 10. To add another, end a tenancy that has finished, or ask to change plan.",
    );
    expect(n.limitText(sub({ planId: "free", tenancyLimit: 2, activeTenancyCount: 3 }))).toContain("On Free you can have 2 tenancies at once, and you have 3.");
  });

  test("every status has a label", () => {
    expect(n.STATUS_LABELS.past_due).toBe("Payment overdue");
  });
});

describe("the edges", () => {
  test("no branch and no reference are left out; monthly pays three months", () => {
    expect(n.howToPay(sub({ interval: "monthly", priceToea: toea(4_000), paymentReference: null }), { ...BANK, branch: "" }))
      .toBe("Pay K120.00 for three months to Sasimem Ltd, BSP account 1001 2345 678.");
  });

  test("never covered at all: past due from the start, with no restriction date to give", () => {
    const notice = n.subscriptionNotice(sub({ status: "active", trialEndsOn: null, paidThrough: null }), d("2026-12-01"), BANK);
    expect(notice?.kind).toBe("pastDue");
    expect(notice?.body).not.toContain("From ");
  });

  test("cancelled names the contact address when there is one, and no purge date when there is none", () => {
    const notice = n.subscriptionNotice(sub({ status: "cancelled", cancelledOn: d("2026-12-01"), purgeAfter: null }), d("2026-12-02"), BANK);
    expect(notice?.body).toBe("No new month will be drafted. Contact Sasimem at help@sasimem.example.");
  });

  test("a limit of one reads in the singular", () => {
    const one = sub({ tenancyLimit: 1, activeTenancyCount: 1 });
    expect(n.usageText(one)).toBe("1 of 1 tenancy");
    expect(n.limitText(one)).toContain("you can have 1 tenancy at once");
  });
});
