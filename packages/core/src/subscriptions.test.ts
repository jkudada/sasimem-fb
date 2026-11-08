import { describe, expect, test } from "vitest";
import { toea } from "./money.js";
import type { CalendarDate } from "./period.js";
import * as s from "./subscriptions.js";

const d = (x: string) => x as CalendarDate;
const sub = (o: Partial<s.SubscriptionTerms> = {}): s.SubscriptionTerms => ({
  planId: "standard", status: "trial", trialEndsOn: d("2026-11-30"), paidThrough: null, graceDays: 14,
  purgeAfter: null, ...o,
});

describe("the plans (PLAN-SUBSCRIBERS §3)", () => {
  test("Free, Standard and Plus have the agreed limits and prices, in whole toea", () => {
    expect(s.DEFAULT_PLANS.map((p) => [p.id, p.tenancyLimit, p.priceToeaMonthly, p.priceToeaAnnual])).toEqual([
      ["free", 2, 0, 0],
      ["standard", 10, 4_000, 40_000],
      ["plus", 30, 10_000, 100_000],
    ]);
  });

  test("a year costs ten months: two months free for paying annually", () => {
    for (const p of s.DEFAULT_PLANS) expect(p.priceToeaAnnual).toBe(p.priceToeaMonthly * 10);
  });

  test("defaultPlan finds a plan by ID", () => {
    expect(s.defaultPlan("plus").name).toBe("Plus");
    expect(() => s.defaultPlan("gold" as s.PlanId)).toThrow(RangeError);
  });

  test("a subscription locks the price for its interval", () => {
    const standard = s.defaultPlan("standard");
    expect(s.priceFor(standard, "annual")).toBe(toea(40_000));
    expect(s.priceFor(standard, "monthly")).toBe(toea(4_000));
  });
});

describe("the tenancy limit", () => {
  test("is the override when there is one, else the plan's", () => {
    expect(s.tenancyLimit(s.defaultPlan("free"), null)).toBe(2);
    expect(s.tenancyLimit(s.defaultPlan("free"), 5)).toBe(5);
  });

  test("a tenancy can be added below the limit, not at it or above it", () => {
    expect(s.canAddTenancy({ activeTenancyCount: 9, tenancyLimit: 10 })).toBe(true);
    expect(s.canAddTenancy({ activeTenancyCount: 10, tenancyLimit: 10 })).toBe(false);
    expect(s.canAddTenancy({ activeTenancyCount: 12, tenancyLimit: 10 })).toBe(false);
  });

  test("a tenancy counts until its end date has passed, by the landlord's day", () => {
    const today = d("2026-11-08");
    expect(s.countsTowardLimit({ endDate: null }, today)).toBe(true);
    expect(s.countsTowardLimit({ endDate: d("2026-11-08") }, today)).toBe(true);
    expect(s.countsTowardLimit({ endDate: d("2026-11-07") }, today)).toBe(false);
  });
});

describe("a subscription's status follows from its dates (PLAN-SUBSCRIBERS §4)", () => {
  const status = (o: Partial<s.SubscriptionTerms>, today: string) => s.subscriptionStatus(sub(o), d(today));

  test("a trial stays a trial through its last day", () => {
    expect(status({}, "2026-11-30")).toBe("trial");
  });

  test("the day after a trial ends it is past due, unless paid; paid, it is active", () => {
    expect(status({}, "2026-12-01")).toBe("past_due");
    expect(status({ paidThrough: d("2027-11-30") }, "2026-12-01")).toBe("active");
  });

  test("paying during a trial does not end it early", () => {
    expect(status({ paidThrough: d("2027-11-30") }, "2026-11-15")).toBe("trial");
  });

  test("active through the paid-through day, past due the day after", () => {
    const paid = { trialEndsOn: null, paidThrough: d("2027-03-31") };
    expect(status(paid, "2027-03-31")).toBe("active");
    expect(status(paid, "2027-04-01")).toBe("past_due");
  });

  test("past due for the grace days, then restricted", () => {
    const paid = { trialEndsOn: null, paidThrough: d("2027-03-31") };
    expect(status(paid, "2027-04-14")).toBe("past_due"); // 14th day of grace
    expect(status(paid, "2027-04-15")).toBe("restricted");
    expect(status({ ...paid, graceDays: 0 }, "2027-04-01")).toBe("restricted");
  });

  test("a payment brings a past-due or restricted subscription straight back to active", () => {
    expect(status({ paidThrough: d("2027-11-30") }, "2027-01-15")).toBe("active");
  });

  test("never covered by a trial or a payment, it is past due", () => {
    expect(status({ trialEndsOn: null }, "2026-11-01")).toBe("past_due");
  });

  test("free never changes on its own", () => {
    expect(status({ planId: "free", status: "free", trialEndsOn: null }, "2040-01-01")).toBe("free");
  });

  test("cancelled stays cancelled until purgeAfter, then purged; purged stays purged", () => {
    expect(status({ status: "cancelled", purgeAfter: d("2027-03-01") }, "2027-02-28")).toBe("cancelled");
    expect(status({ status: "cancelled", purgeAfter: d("2027-03-01") }, "2027-03-01")).toBe("purged");
    expect(status({ status: "purged" }, "2026-01-01")).toBe("purged");
  });

  test("is idempotent: applying it to its own answer gives the same answer", () => {
    for (const today of ["2026-11-01", "2026-12-01", "2026-12-20", "2027-06-01"]) {
      const once = status({}, today);
      expect(status({ status: once }, today)).toBe(once);
    }
  });

  test("the day it became past due, for banners and grace", () => {
    expect(s.pastDueSince(sub(), d("2026-12-03"))).toBe("2026-12-01");
    expect(s.pastDueSince(sub({ paidThrough: d("2027-11-30") }), d("2026-12-03"))).toBeNull();
  });
});

describe("what a payment pays for", () => {
  test("annual adds twelve months after the paid-through day", () => {
    const paid = sub({ trialEndsOn: null, paidThrough: d("2027-03-14") });
    expect(s.extendPaidThrough(paid, 12, d("2027-03-01"))).toBe("2028-03-14");
  });

  test("paid during a trial, the year starts when the trial ends", () => {
    expect(s.extendPaidThrough(sub(), 12, d("2026-11-10"))).toBe("2027-11-30");
  });

  test("paid while past due, it counts from the old paid-through day: grace is not free time", () => {
    const paid = sub({ trialEndsOn: null, paidThrough: d("2027-03-31") });
    expect(s.extendPaidThrough(paid, 12, d("2027-04-10"))).toBe("2028-03-31");
  });

  test("paid while restricted, it counts from today: the landlord was not being served", () => {
    const paid = sub({ trialEndsOn: null, paidThrough: d("2027-03-31") });
    expect(s.extendPaidThrough(paid, 12, d("2027-06-10"))).toBe("2028-06-09");
  });

  test("a month-end paid-through day stays at month end", () => {
    const jan = sub({ trialEndsOn: null, paidThrough: d("2027-01-31") });
    expect(s.extendPaidThrough(jan, 1, d("2027-01-20"))).toBe("2027-02-28");
    const feb = sub({ trialEndsOn: null, paidThrough: d("2027-02-28") });
    expect(s.extendPaidThrough(feb, 1, d("2027-02-20"))).toBe("2027-03-31");
    const mid = sub({ trialEndsOn: null, paidThrough: d("2027-01-30") });
    expect(s.extendPaidThrough(mid, 1, d("2027-01-20"))).toBe("2027-02-28"); // 30 Feb does not exist
  });

  test("refuses a payment for no time", () => {
    expect(() => s.extendPaidThrough(sub(), 0, d("2026-11-10"))).toThrow(RangeError);
    expect(() => s.extendPaidThrough(sub(), 1.5, d("2026-11-10"))).toThrow(RangeError);
  });

  test("a subscription never covered at all counts from today", () => {
    expect(s.extendPaidThrough(sub({ trialEndsOn: null }), 12, d("2026-11-10"))).toBe("2027-11-09");
  });
});

describe("drafting and references", () => {
  test("drafting is allowed in trial, free, active and past due; not restricted, cancelled or purged", () => {
    const yes: s.SubscriptionStatus[] = ["trial", "free", "active", "past_due"];
    const no: s.SubscriptionStatus[] = ["restricted", "cancelled", "purged"];
    for (const x of yes) expect(s.canDraft(x)).toBe(true);
    for (const x of no) expect(s.canDraft(x)).toBe(false);
  });

  test("payment references are SUB- and four digits, growing past four when needed", () => {
    expect(s.subscriptionReference(42)).toBe("SUB-0042");
    expect(s.subscriptionReference(12345)).toBe("SUB-12345");
    expect(() => s.subscriptionReference(0)).toThrow(RangeError);
    expect(() => s.subscriptionReference(2.5)).toThrow(RangeError);
  });

  test("a trial lasts sixty days counting the first", () => {
    expect(s.trialEndsOn(d("2026-11-08"))).toBe("2027-01-06");
  });
});

describe("a new subscriber's subscription document", () => {
  test("a sign-up starts a sixty-day trial on Standard, priced annually, nothing counted yet", () => {
    expect(s.newTrialSubscription({ plan: s.defaultPlan("standard"), today: d("2026-11-08"), referenceNumber: 42 })).toEqual({
      planId: "standard", status: "trial", interval: "annual", priceToea: 40_000, tenancyLimit: 10, limitOverride: null,
      trialEndsOn: "2027-01-06", paidThrough: null, graceDays: 14, cancelledOn: null, purgeAfter: null,
      paymentReference: "SUB-0042", activeTenancyCount: 0,
    });
  });

  test("an org from before billing is free for good, its limit never below what it already has (D6)", () => {
    const free = s.newFreeSubscription({ plan: s.defaultPlan("free"), activeTenancyCount: 5 });
    expect(free).toMatchObject({ planId: "free", status: "free", priceToea: 0, tenancyLimit: 5, limitOverride: 5, trialEndsOn: null, paymentReference: null, activeTenancyCount: 5 });
    expect(s.newFreeSubscription({ plan: s.defaultPlan("free"), activeTenancyCount: 1 })).toMatchObject({ tenancyLimit: 2, limitOverride: null });
  });
});

describe("reading a plan stored in Firestore", () => {
  const stored = { name: "Standard", tenancyLimit: 12, priceToeaMonthly: 4_500, priceToeaAnnual: 45_000, public: true, order: 1 };

  test("a well-formed plan document is used as it is: prices are data", () => {
    expect(s.planFrom("standard", stored)).toEqual({ id: "standard", ...stored });
  });

  test("a missing plan falls back to the default; a malformed one is refused rather than guessed", () => {
    expect(s.planFrom("standard", undefined)).toEqual(s.defaultPlan("standard"));
    expect(() => s.planFrom("standard", { ...stored, priceToeaAnnual: 450.5 })).toThrow(TypeError);
    expect(() => s.planFrom("standard", { ...stored, tenancyLimit: "12" })).toThrow(TypeError);
  });
});
