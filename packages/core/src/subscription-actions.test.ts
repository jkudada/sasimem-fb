import { describe, expect, test } from "vitest";
import type { CalendarDate } from "./period.js";
import * as a from "./subscription-actions.js";
import { defaultPlan, newFreeSubscription, newTrialSubscription, type SubscriptionFields } from "./subscriptions.js";

const d = (x: string) => x as CalendarDate;
const TODAY = d("2027-03-10");
const standard = defaultPlan("standard");
const plus = defaultPlan("plus");
const free = defaultPlan("free");

/** Paid through the end of April 2027, on Standard, annually. */
const paid = (o: Partial<SubscriptionFields> = {}): SubscriptionFields => ({
  ...newTrialSubscription({ plan: standard, today: d("2026-01-01"), referenceNumber: 7 }),
  status: "active", paidThrough: d("2027-04-30"), activeTenancyCount: 4, ...o,
});
const ctx = (o: Partial<a.ActionContext> = {}): a.ActionContext => ({ today: TODAY, plan: standard, referenceNumber: 51, ...o });
const ok = (r: a.ActionResult) => {
  if (!r.ok) throw new Error(`refused: ${r.problem}`);
  return r;
};
const problem = (r: a.ActionResult) => (r.ok ? null : r.problem);
const payment = (o: Record<string, unknown> = {}) =>
  ({ kind: "recordPayment", amountToea: 40_000, receivedOn: "2027-03-08", bankReference: "BSP 445566", months: 12, ...o }) as a.OperatorAction;

describe("reading an action (the console and the server agree)", () => {
  test("a well-formed action is read as it is, trimmed", () => {
    expect(a.operatorActionFrom(payment({ bankReference: "  BSP 445566 " }))).toEqual(payment());
    expect(a.operatorActionFrom({ kind: "setLimitOverride", limit: null })).toEqual({ kind: "setLimitOverride", limit: null });
    expect(a.operatorActionFrom({ kind: "addNote", text: " Rang Mary. " })).toEqual({ kind: "addNote", text: "Rang Mary." });
  });

  test("an unknown kind or a malformed field is refused in plain words", () => {
    const refused = (x: unknown) => {
      const r = a.operatorActionFrom(x);
      return "problem" in r ? r.problem : null;
    };
    expect(refused(null)).toMatch(/could not be read/);
    expect(refused({ kind: "deleteEverything" })).toMatch(/could not be read/);
    expect(refused(payment({ amountToea: 400.5 }))).toBe("The amount must be more than K0.00.");
    expect(refused(payment({ amountToea: 0 }))).toBe("The amount must be more than K0.00.");
    expect(refused(payment({ receivedOn: "2027-02-30" }))).toBe("Enter the day the money arrived.");
    expect(refused(payment({ bankReference: "  " }))).toBe("Enter the bank's reference for the transfer.");
    expect(refused(payment({ months: 0 }))).toBe("A payment covers 1 to 36 whole months.");
    expect(refused(payment({ months: 37 }))).toBe("A payment covers 1 to 36 whole months.");
    expect(refused({ kind: "changePlan", planId: "gold", interval: "annual" })).toBe("Choose Free, Standard or Plus.");
    expect(refused({ kind: "changePlan", planId: "plus", interval: "weekly" })).toBe("Choose annual or monthly billing.");
    expect(refused({ kind: "extendTrial", days: 0 })).toBe("Extend a trial by 1 to 365 days.");
    expect(refused({ kind: "setLimitOverride", limit: 0 })).toBe("A limit is a whole number from 1 to 1000, or blank for the plan's.");
    expect(refused({ kind: "addNote", text: "" })).toBe("Write the note first.");
    expect(refused({ kind: "addNote", text: "x".repeat(2001) })).toBe("A note is at most 2000 characters.");
  });
});

describe("what can be done to a subscription in each status", () => {
  test("a purged subscription takes no action", () => {
    expect(problem(a.applyOperatorAction(paid({ status: "purged" }), { kind: "addNote", text: "hi" }, ctx()))).toBe("This subscription has been purged.");
  });

  test("a cancelled one takes only reinstate and a note", () => {
    const cancelled = paid({ status: "cancelled", cancelledOn: d("2027-03-01"), purgeAfter: d("2027-05-30") });
    expect(problem(a.applyOperatorAction(cancelled, { kind: "extendTrial", days: 10 }, ctx()))).toBe("Reinstate the subscription first.");
    expect(a.applyOperatorAction(cancelled, { kind: "addNote", text: "asked to come back" }, ctx()).ok).toBe(true);
    expect(a.applyOperatorAction(cancelled, { kind: "reinstate" }, ctx()).ok).toBe(true);
  });

  test("an action that would change nothing is refused, so the audit trail holds only changes", () => {
    expect(problem(a.applyOperatorAction(paid(), { kind: "changePlan", planId: "standard", interval: "annual" }, ctx()))).toBe("Nothing to change.");
    expect(problem(a.applyOperatorAction(paid(), { kind: "setLimitOverride", limit: null }, ctx()))).toBe("Nothing to change.");
  });

  test("every change re-evaluates the status as of today", () => {
    // Stored as active, but its paid-through day has passed by today: the action stores past_due.
    const stale = paid({ paidThrough: d("2027-03-01"), trialEndsOn: null });
    expect(ok(a.applyOperatorAction(stale, { kind: "setLimitOverride", limit: 12 }, ctx())).sub.status).toBe("past_due");
  });
});

describe("recording a payment", () => {
  test("moves paidThrough by the months paid and says which days it covers", () => {
    const r = ok(a.applyOperatorAction(paid(), payment(), ctx()));
    expect(r.sub).toMatchObject({ paidThrough: "2028-04-30", status: "active" });
    expect(r.payment).toEqual({ coversFrom: "2027-05-01", coversTo: "2028-04-30" });
  });

  test("counts from the day the money arrived: recording it late costs the landlord nothing", () => {
    // Fell due 1 Jan, restricted from 15 Jan; the money arrived on the 10th (in grace),
    // so it continues from the old paidThrough, though recorded on 10 March.
    const late = paid({ trialEndsOn: null, paidThrough: d("2026-12-31"), status: "restricted" });
    const r = ok(a.applyOperatorAction(late, payment({ receivedOn: "2027-01-10" }), ctx()));
    expect(r.payment).toEqual({ coversFrom: "2027-01-01", coversTo: "2027-12-31" });
    expect(r.sub.status).toBe("active");
  });

  test("paid while restricted, the term starts the day the money arrived", () => {
    const restricted = paid({ trialEndsOn: null, paidThrough: d("2026-12-31"), status: "restricted" });
    const r = ok(a.applyOperatorAction(restricted, payment({ receivedOn: "2027-03-08", months: 1 }), ctx()));
    expect(r.payment).toEqual({ coversFrom: "2027-03-08", coversTo: "2027-04-07" });
    expect(r.sub.status).toBe("active");
  });

  test("a payment from the future, or for a free subscription, is refused", () => {
    expect(problem(a.applyOperatorAction(paid(), payment({ receivedOn: "2027-03-11" }), ctx()))).toBe("The money cannot have arrived after today.");
    const f = newFreeSubscription({ plan: free, activeTenancyCount: 1 });
    expect(problem(a.applyOperatorAction(f, payment(), ctx({ plan: free })))).toBe("A free subscription is not paid for. Change its plan first.");
  });

  test("while restricted by hand, it still counts from the covered day", () => {
    const held = paid({ manuallyRestricted: true, status: "restricted" });
    const r = ok(a.applyOperatorAction(held, payment(), ctx()));
    expect(r.payment?.coversFrom).toBe("2027-05-01");
    expect(r.sub.status).toBe("restricted"); // the hand restriction stays until lifted
  });
});

describe("changing the plan", () => {
  test("locks the new plan's price for the interval; the limit follows the plan", () => {
    const r = ok(a.applyOperatorAction(paid(), { kind: "changePlan", planId: "plus", interval: "monthly" }, ctx({ plan: plus })));
    expect(r.sub).toMatchObject({ planId: "plus", interval: "monthly", priceToea: 10_000, tenancyLimit: 30, status: "active" });
  });

  test("an override survives a change of plan", () => {
    const r = ok(a.applyOperatorAction(paid({ limitOverride: 15, tenancyLimit: 15 }), { kind: "changePlan", planId: "plus", interval: "annual" }, ctx({ plan: plus })));
    expect(r.sub.tenancyLimit).toBe(15);
  });

  test("a downgrade below current use changes no count: over the limit, nothing ended", () => {
    const r = ok(a.applyOperatorAction(paid({ activeTenancyCount: 8 }), { kind: "changePlan", planId: "free", interval: "annual" }, ctx({ plan: free })));
    expect(r.sub).toMatchObject({ planId: "free", status: "free", priceToea: 0, tenancyLimit: 2, activeTenancyCount: 8 });
  });

  test("from free to a paid plan: given the next reference, and past due until paid or given a trial", () => {
    const f = newFreeSubscription({ plan: free, activeTenancyCount: 1 });
    const r = ok(a.applyOperatorAction(f, { kind: "changePlan", planId: "standard", interval: "annual" }, ctx()));
    expect(r.sub).toMatchObject({ planId: "standard", status: "past_due", priceToea: 40_000, tenancyLimit: 10, paymentReference: "SUB-0051" });
    expect(r.usedReference).toBe(true);
    expect(ok(a.applyOperatorAction(paid(), { kind: "changePlan", planId: "plus", interval: "annual" }, ctx({ plan: plus }))).usedReference).toBe(false);
  });

  test("the plan the context carries must be the one asked for", () => {
    expect(() => a.applyOperatorAction(paid(), { kind: "changePlan", planId: "plus", interval: "annual" }, ctx())).toThrow(RangeError);
  });
});

describe("trials, limits and restriction by hand", () => {
  test("extending a trial adds days after its end, or after yesterday if it has ended; past due becomes trial", () => {
    const trial = paid({ status: "trial", trialEndsOn: d("2027-03-20"), paidThrough: null });
    expect(ok(a.applyOperatorAction(trial, { kind: "extendTrial", days: 10 }, ctx())).sub.trialEndsOn).toBe("2027-03-30");
    const lapsed = paid({ status: "past_due", trialEndsOn: d("2027-03-01"), paidThrough: null });
    const r = ok(a.applyOperatorAction(lapsed, { kind: "extendTrial", days: 14 }, ctx()));
    expect(r.sub).toMatchObject({ trialEndsOn: "2027-03-23", status: "trial" });
  });

  test("a free subscription has no trial to extend", () => {
    expect(problem(a.applyOperatorAction(newFreeSubscription({ plan: free, activeTenancyCount: 0 }), { kind: "extendTrial", days: 5 }, ctx({ plan: free }))))
      .toBe("A free subscription has no trial.");
  });

  test("a limit set by hand replaces the plan's; clearing it gives the plan's back", () => {
    const set = ok(a.applyOperatorAction(paid(), { kind: "setLimitOverride", limit: 25 }, ctx())).sub;
    expect(set).toMatchObject({ limitOverride: 25, tenancyLimit: 25 });
    expect(ok(a.applyOperatorAction(set, { kind: "setLimitOverride", limit: null }, ctx())).sub).toMatchObject({ limitOverride: null, tenancyLimit: 10 });
  });

  test("restricting by hand holds the status at restricted, free included, until lifted", () => {
    const r = ok(a.applyOperatorAction(newFreeSubscription({ plan: free, activeTenancyCount: 0 }), { kind: "restrict" }, ctx({ plan: free })));
    expect(r.sub).toMatchObject({ manuallyRestricted: true, status: "restricted" });
    expect(problem(a.applyOperatorAction(r.sub, { kind: "restrict" }, ctx({ plan: free })))).toBe("Already restricted by hand.");
    expect(ok(a.applyOperatorAction(r.sub, { kind: "unrestrict" }, ctx({ plan: free }))).sub).toMatchObject({ manuallyRestricted: false, status: "free" });
  });

  test("unrestrict says so when the restriction is for non-payment", () => {
    const unpaid = paid({ trialEndsOn: null, paidThrough: d("2026-12-31"), status: "restricted" });
    expect(problem(a.applyOperatorAction(unpaid, { kind: "unrestrict" }, ctx())))
      .toBe("This is restricted because it is unpaid, not by hand. Record a payment or extend the trial.");
  });
});

describe("cancelling and reinstating", () => {
  test("cancelled today, purged 90 days on", () => {
    const r = ok(a.applyOperatorAction(paid(), { kind: "cancelSubscription" }, ctx()));
    expect(r.sub).toMatchObject({ status: "cancelled", cancelledOn: "2027-03-10", purgeAfter: "2027-06-08" });
    expect(problem(a.applyOperatorAction(r.sub, { kind: "cancelSubscription" }, ctx()))).toBe("Already cancelled.");
  });

  test("reinstating gives back the status the dates say; free stays free", () => {
    const cancelled = ok(a.applyOperatorAction(paid(), { kind: "cancelSubscription" }, ctx())).sub;
    expect(ok(a.applyOperatorAction(cancelled, { kind: "reinstate" }, ctx())).sub).toMatchObject({ status: "active", cancelledOn: null, purgeAfter: null });
    const f = ok(a.applyOperatorAction(newFreeSubscription({ plan: free, activeTenancyCount: 0 }), { kind: "cancelSubscription" }, ctx({ plan: free }))).sub;
    expect(ok(a.applyOperatorAction(f, { kind: "reinstate" }, ctx({ plan: free }))).sub.status).toBe("free");
    expect(problem(a.applyOperatorAction(paid(), { kind: "reinstate" }, ctx()))).toBe("Only a cancelled subscription can be reinstated.");
  });

  test("after purgeAfter it cannot be reinstated", () => {
    const cancelled = paid({ status: "cancelled", cancelledOn: d("2026-12-01"), purgeAfter: d("2027-03-01") });
    expect(problem(a.applyOperatorAction(cancelled, { kind: "reinstate" }, ctx()))).toBe("This subscription has been purged.");
  });
});

describe("notes and the audit diff", () => {
  test("a note leaves the subscription as it was", () => {
    const r = ok(a.applyOperatorAction(paid(), { kind: "addNote", text: "Rang Mary about April." }, ctx()));
    expect(r.sub).toEqual(paid());
    expect(r.note).toBe("Rang Mary about April.");
  });

  test("the diff lists only the fields that changed, before and after", () => {
    const before = paid();
    const after = ok(a.applyOperatorAction(before, payment(), ctx())).sub;
    expect(a.subscriptionDiff(before, after)).toEqual({ before: { paidThrough: "2027-04-30" }, after: { paidThrough: "2028-04-30" } });
  });
});
