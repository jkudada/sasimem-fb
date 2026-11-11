import { type CalendarDate, newTrialSubscription, defaultPlan, newFreeSubscription, type SubscriptionFields } from "@sasimem/core";
import { describe, expect, test } from "vitest";
import { filterRows, healthView, subscriberRow } from "./rows.js";
import type { EmailSummary, RunSummary, SubscriberInput } from "./types.js";

const now = new Date("2027-03-01T00:00:00Z"); // 1 March 2027, 10 am in Port Moresby
const trial = (o: Partial<SubscriptionFields> = {}): SubscriptionFields =>
  ({ ...newTrialSubscription({ plan: defaultPlan("standard"), today: "2027-02-01" as CalendarDate, referenceNumber: 7 }), ...o });
const run = (o: Partial<RunSummary> = {}): RunSummary =>
  ({ period: "2027-02", status: "sent", approvedAt: new Date("2027-01-29T00:00:00Z"), invoiceCount: 3, totalToea: 360_000, ...o });
const email = (o: Partial<EmailSummary> = {}): EmailSummary =>
  ({ id: "e1", kind: "tenantInvoice", to: "t@x.example", subject: "Invoice", status: "sent", sentAt: new Date("2027-02-20T00:00:00Z"), error: null, ...o });
const input = (o: Partial<SubscriberInput> = {}): SubscriberInput => ({
  org: { id: "o1", name: "Wari Holdings", email: "mary@wari.example", createdAt: new Date("2026-06-01T00:00:00Z") },
  sub: trial(), runs: [run()], emails: [email()], ...o,
});

describe("one row per subscriber (PLAN-SUBSCRIBERS §7)", () => {
  test("shows plan, the status as of today, tenancies used of the limit, the date that matters and the reference", () => {
    const row = subscriberRow(input({ sub: trial({ activeTenancyCount: 7 }) }), now);
    expect(row).toMatchObject({
      orgId: "o1", name: "Wari Holdings", plan: "Standard", status: "trial", used: 7, limit: 10,
      until: { label: "Trial ends", date: "2027-04-01" }, reference: "SUB-0007", held: 0, failedEmails: 0, problems: [],
    });
  });

  test("the status is worked out from the dates today, not taken from the stored field (the daily tick comes in S4)", () => {
    const lapsed = trial({ trialEndsOn: "2027-02-10" as CalendarDate, status: "trial" });
    expect(subscriberRow(input({ sub: lapsed }), now).status).toBe("restricted"); // 11 Feb + 14 days of grace = 25 Feb
  });

  test("a paid subscriber shows the paid-through date", () => {
    const paid = trial({ trialEndsOn: null, paidThrough: "2028-01-31" as CalendarDate });
    expect(subscriberRow(input({ sub: paid }), now)).toMatchObject({ status: "active", until: { label: "Paid through", date: "2028-01-31" } });
  });

  test("a free subscriber has no date and no reference", () => {
    const free = newFreeSubscription({ plan: defaultPlan("free"), activeTenancyCount: 1 });
    expect(subscriberRow(input({ sub: free }), now)).toMatchObject({ plan: "Free", status: "free", until: null, reference: null });
  });

  test("last approval is the latest approval of any run", () => {
    const runs = [run({ period: "2027-01", approvedAt: new Date("2026-12-29T00:00:00Z") }), run(), run({ period: "2027-03", status: "awaitingApproval", approvedAt: null })];
    expect(subscriberRow(input({ runs }), now).lastApproval).toEqual(new Date("2027-01-29T00:00:00Z"));
  });

  describe("problems that make a subscriber unhealthy", () => {
    test("a held run", () => {
      const row = subscriberRow(input({ runs: [run(), run({ period: "2027-03", status: "held", approvedAt: null })] }), now);
      expect(row.held).toBe(1);
      expect(row.problems).toEqual(["1 held run"]);
    });

    test("failed emails in the last 30 days", () => {
      const row = subscriberRow(input({ emails: [email(), email({ id: "e2", status: "failed" }), email({ id: "e3", status: "failed" })] }), now);
      expect(row.problems).toEqual(["2 emails failed"]);
    });

    test("no approval in two months, for an org older than that", () => {
      const quiet = input({ runs: [run({ approvedAt: new Date("2026-12-20T00:00:00Z") })] });
      expect(subscriberRow(quiet, now).problems).toEqual(["no approval in 2 months"]);
      const never = input({ runs: [] });
      expect(subscriberRow(never, now).problems).toEqual(["no approval in 2 months"]);
      const newcomer = input({ runs: [], org: { ...input().org, createdAt: new Date("2027-02-01T00:00:00Z") } });
      expect(subscriberRow(newcomer, now).problems).toEqual([]);
    });

    test("more tenancies than the limit allows", () => {
      expect(subscriberRow(input({ sub: trial({ activeTenancyCount: 12 }) }), now).problems).toEqual(["over the limit"]);
    });

    test("no subscription at all (missed by the backfill)", () => {
      expect(subscriberRow(input({ sub: null }), now)).toMatchObject({ status: "none", plan: "-", used: null, limit: null, problems: ["no subscription"] });
    });
  });
});

describe("the filters", () => {
  const rows = [
    subscriberRow(input({ org: { ...input().org, id: "a", name: "A" } }), now), // trial ends 1 April: not within 14 days
    subscriberRow(input({ org: { ...input().org, id: "b", name: "B" }, sub: trial({ trialEndsOn: "2027-03-10" as CalendarDate }) }), now),
    subscriberRow(input({ org: { ...input().org, id: "c", name: "C" }, sub: trial({ trialEndsOn: "2027-02-25" as CalendarDate }) }), now),
    subscriberRow(input({ org: { ...input().org, id: "d", name: "D" }, sub: trial({ trialEndsOn: "2027-02-10" as CalendarDate }) }), now),
    subscriberRow(input({ org: { ...input().org, id: "e", name: "E" }, runs: [run({ status: "held" })] }), now),
  ];
  const ids = (f: Parameters<typeof filterRows>[1]) => filterRows(rows, f).map((r) => r.orgId);

  test("all, past due, restricted, trial ending within 14 days, unhealthy", () => {
    expect(ids("all")).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids("pastDue")).toEqual(["c"]);
    expect(ids("restricted")).toEqual(["d"]);
    expect(ids("trialEnding")).toEqual(["b"]);
    expect(ids("unhealthy")).toEqual(["e"]);
  });
});

describe("health across all subscribers", () => {
  const inputs = [
    input({ org: { ...input().org, id: "a", name: "A" }, runs: [run({ period: "2027-03", status: "held", approvedAt: null }), run()] }),
    input({ org: { ...input().org, id: "b", name: "B" }, emails: [email({ status: "failed", to: "bad@x.example", error: "Invalid `to` field." })] }),
    input({ org: { ...input().org, id: "c", name: "C" }, runs: [] }),
  ];

  test("the last successful tick, and whether it is overdue (none in 3 hours)", () => {
    expect(healthView(inputs, { lastSuccessAt: new Date("2027-02-28T23:10:00Z"), tally: {} }, now).tick).toEqual({ lastSuccessAt: new Date("2027-02-28T23:10:00Z"), overdue: false });
    expect(healthView(inputs, { lastSuccessAt: new Date("2027-02-28T20:59:00Z"), tally: {} }, now).tick).toMatchObject({ overdue: true });
    expect(healthView(inputs, null, now).tick).toBeNull();
  });

  test("the daily subscription tick is overdue after 26 hours (S4)", () => {
    const at = (iso: string) => ({ lastSuccessAt: new Date(iso), tally: {} });
    expect(healthView(inputs, null, now, at("2027-02-28T20:00:00Z")).subscriptionTick).toMatchObject({ overdue: false });
    expect(healthView(inputs, null, now, at("2027-02-27T20:00:00Z")).subscriptionTick).toMatchObject({ overdue: true });
    expect(healthView(inputs, null, now).subscriptionTick).toBeNull();
  });

  test("held runs, failed emails and quiet subscribers, each naming the org", () => {
    const h = healthView(inputs, null, now);
    expect(h.held).toEqual([{ orgId: "a", name: "A", period: "2027-03" }]);
    expect(h.failedEmails).toEqual([{ orgId: "b", name: "B", to: "bad@x.example", kind: "tenantInvoice", error: "Invalid `to` field.", sentAt: new Date("2027-02-20T00:00:00Z") }]);
    expect(h.quiet.map((q) => q.orgId)).toEqual(["c"]);
  });
});
