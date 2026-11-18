import { describe, expect, test } from "vitest";
import { toea } from "./money.js";
import type { CalendarDate } from "./period.js";
import * as l from "./subscription-lifecycle.js";
import type { SubscriptionFields } from "./subscriptions.js";

const d = (x: string) => x as CalendarDate;
const sub = (o: Partial<SubscriptionFields> = {}): SubscriptionFields => ({
  planId: "standard", status: "trial", interval: "annual", priceToea: toea(40_000), tenancyLimit: 10, limitOverride: null,
  trialEndsOn: d("2026-10-30"), paidThrough: null, graceDays: 14, cancelledOn: null, purgeAfter: null,
  paymentReference: "SUB-0042", activeTenancyCount: 1, ...o,
});
const due = (today: string, o: Partial<l.LifecycleFacts> = {}) =>
  l.lifecycleNoticesDue({ sub: sub(), createdOn: d("2026-09-01"), hasTenancy: true, ...o }, d(today)).map((n) => n.key);

describe("lifecycle emails due (PLAN-SUBSCRIBERS §9)", () => {
  test("welcome on sign-up day and the two after, never later: a deploy emails no old org", () => {
    expect(due("2026-09-01")).toEqual(["welcome"]);
    expect(due("2026-09-03")).toEqual(["welcome"]);
    expect(due("2026-09-04")).toEqual([]);
    expect(due("2026-08-31")).toEqual([]); // a clock before sign-up says nothing
  });

  test("the setup nudge from 3 days after sign-up while there is no tenancy, and only within 10 days", () => {
    expect(due("2026-09-03", { hasTenancy: false })).toEqual(["welcome"]);
    expect(due("2026-09-04", { hasTenancy: false })).toEqual(["setupNudge"]);
    expect(due("2026-09-04")).toEqual([]);
    expect(due("2026-09-12", { hasTenancy: false })).toEqual([]);
  });

  test("the trial reminders at 14 and 3 days, keyed by the end date so an extension reminds again", () => {
    expect(due("2026-10-15")).toEqual([]);
    expect(due("2026-10-16")).toEqual(["trialEnding14_2026-10-30"]);
    expect(due("2026-10-26")).toEqual(["trialEnding14_2026-10-30"]);
    expect(due("2026-10-27")).toEqual(["trialEnding3_2026-10-30"]);
    expect(due("2026-10-30")).toEqual(["trialEnding3_2026-10-30"]);
    expect(due("2026-11-10", { sub: sub({ trialEndsOn: d("2026-11-20") }) })).toEqual(["trialEnding14_2026-11-20"]);
  });

  test("a trial shorter than two weeks goes straight to the nearest reminder", () => {
    expect(due("2026-09-02", { createdOn: d("2026-08-20"), sub: sub({ trialEndsOn: d("2026-09-04") }) })).toEqual(["trialEnding3_2026-09-04"]);
  });

  test("past due and restricted, each keyed by the first unpaid day", () => {
    expect(due("2026-11-01")).toEqual(["pastDue_2026-10-31"]);
    expect(due("2026-11-14")).toEqual(["restricted_2026-10-31"]);
    const lapsedAgain = sub({ status: "active", trialEndsOn: null, paidThrough: d("2027-10-31") });
    expect(due("2027-11-01", { sub: lapsedAgain })).toEqual(["pastDue_2027-11-01"]);
    expect(due("2026-12-01", { sub: sub({ trialEndsOn: null }) })).toEqual(["pastDue_never"]);
  });

  test("a hand restriction, free, active, cancelled: nothing about payment", () => {
    expect(due("2026-11-20", { sub: sub({ manuallyRestricted: true }) })).toEqual([]);
    expect(due("2026-11-20", { sub: sub({ planId: "free", status: "free", trialEndsOn: null }) })).toEqual([]);
    expect(due("2026-11-20", { sub: sub({ status: "active", paidThrough: d("2027-10-31") }) })).toEqual([]);
    expect(due("2026-11-20", { sub: sub({ status: "cancelled", purgeAfter: d("2027-01-01") }) })).toEqual([]);
  });
});

describe("revenue", () => {
  test("annual counts its price; monthly twelve times", () => {
    expect(l.annualisedToea(sub())).toBe(40_000);
    expect(l.annualisedToea(sub({ interval: "monthly", priceToea: toea(4_000) }))).toBe(48_000);
  });

  test("renewal is due on the last day covered, paid or trial", () => {
    expect(l.renewalDue(sub())).toBe("2026-10-30");
    expect(l.renewalDue(sub({ paidThrough: d("2027-10-31") }))).toBe("2027-10-31");
    expect(l.renewalDue(sub({ trialEndsOn: null }))).toBeNull();
  });
});
