import { canAddTenancy } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeOperatorCallables } from "../src/callables/operator.js";
import { OPERATOR, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer } from "./harness/mailer.js";
import { addTenancy, anOrgWith } from "./harness/seed.js";

const now = new Date("2027-03-10T01:00:00Z"); // 10 March in Port Moresby
const mailer = new FakeMailer();
const { operatorAction } = makeOperatorCallables({ now: () => now, mailer, appUrl: () => "https://app.example" });
const OP_UID = "operator-joe";
const act = (orgId: string, action: Record<string, unknown>, claims: Record<string, unknown> = OPERATOR) =>
  operatorAction.run(request(OP_UID, { orgId, action }, claims));
const subOf = async (orgId: string) => (await adminDb().doc(`subscriptions/${orgId}`).get()).data() ?? {};
const eventsOf = async (orgId: string) => (await adminDb().collection("operatorEvents").where("orgId", "==", orgId).get()).docs.map((d) => d.data());

/** An org made by the real createOrg (a trial from 1 Sep 2026), then paid through April 2027. */
async function paidOrg(o: Record<string, unknown> = {}) {
  const { orgId } = await anOrgWith();
  await adminDb().doc(`subscriptions/${orgId}`).update({ status: "active", paidThrough: "2027-04-30", ...o });
  return orgId;
}
const payment = (o: Record<string, unknown> = {}) =>
  ({ kind: "recordPayment", amountToea: 40_000, receivedOn: "2027-03-08", bankReference: `BSP ${crypto.randomUUID().slice(0, 8)}`, months: 12, ...o });

describe("who may act (PLAN-SUBSCRIBERS D10)", () => {
  test("refuses a caller without the operator claim, and one with it but no second factor; writes nothing", async () => {
    const orgId = await paidOrg();
    const before = await subOf(orgId);
    const landlord = { email: "mary@wari.example", firebase: { sign_in_provider: "password" } };
    const noCode = { ...OPERATOR, firebase: { sign_in_provider: "password" } };
    for (const claims of [landlord, noCode]) {
      await expect(act(orgId, payment(), claims)).rejects.toMatchObject({ code: "permission-denied", message: "Only a Sasimem operator, signed in with their code, can do this." });
    }
    await expect(operatorAction.run(request(null, { orgId, action: payment() }))).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await subOf(orgId)).toEqual(before);
    expect(await eventsOf(orgId)).toEqual([]);
  });

  test("an unknown org, or one with no subscription, is refused plainly", async () => {
    await expect(act("no-such-org", payment())).rejects.toMatchObject({ code: "not-found", message: "That organisation has no subscription." });
  });

  test("a malformed action is refused with core's words", async () => {
    const orgId = await paidOrg();
    await expect(act(orgId, payment({ months: 0 }))).rejects.toMatchObject({ code: "invalid-argument", message: "A payment covers 1 to 36 whole months." });
  });
});

describe("recording a payment", () => {
  test("writes the payment, moves paidThrough, re-evaluates status and audits it, all together", async () => {
    const orgId = await paidOrg({ status: "restricted", trialEndsOn: null, paidThrough: "2026-12-31" });
    const p = payment({ receivedOn: "2027-03-08", months: 12 });
    expect(await act(orgId, p)).toMatchObject({ status: "active", duplicate: false });

    expect(await subOf(orgId)).toMatchObject({ status: "active", paidThrough: "2028-03-07", updatedAt: Timestamp.fromDate(now) });
    const payments = (await adminDb().collection(`subscriptions/${orgId}/payments`).get()).docs.map((d) => d.data());
    expect(payments).toEqual([{
      amountToea: 40_000, receivedOn: "2027-03-08", method: "bank", bankReference: p.bankReference, months: 12,
      coversFrom: "2027-03-08", coversTo: "2028-03-07", recordedBy: OP_UID, at: Timestamp.fromDate(now),
    }]);
    expect(await eventsOf(orgId)).toEqual([{
      kind: "recordPayment", orgId, actor: OP_UID, actorEmail: OPERATOR.email, at: Timestamp.fromDate(now),
      before: { status: "restricted", paidThrough: "2026-12-31" }, after: { status: "active", paidThrough: "2028-03-07" },
      detail: { amountToea: 40_000, bankReference: p.bankReference, months: 12, receivedOn: "2027-03-08" },
    }]);
  });

  test("twice with the same bank reference, it is recorded once", async () => {
    const orgId = await paidOrg();
    const p = payment();
    await act(orgId, p);
    expect(await act(orgId, { ...p, bankReference: ` ${p.bankReference.toLowerCase()} ` })).toMatchObject({ duplicate: true });
    expect((await subOf(orgId))["paidThrough"]).toBe("2028-04-30");
    expect((await adminDb().collection(`subscriptions/${orgId}/payments`).get()).size).toBe(1);
    expect(await eventsOf(orgId)).toHaveLength(1);
  });

  test("a refused action writes nothing, not even an audit entry", async () => {
    const orgId = await paidOrg();
    await expect(act(orgId, payment({ receivedOn: "2027-03-11" }))).rejects.toMatchObject({ code: "failed-precondition", message: "The money cannot have arrived after today." });
    expect((await adminDb().collection(`subscriptions/${orgId}/payments`).get()).size).toBe(0);
    expect(await eventsOf(orgId)).toEqual([]);
  });
});

describe("changing the plan", () => {
  test("a downgrade below current use keeps every tenancy and blocks new ones", async () => {
    const orgId = await paidOrg();
    for (const id of ["k1", "k2", "k3"]) await addTenancy(orgId, { id });
    await adminDb().doc(`subscriptions/${orgId}`).update({ activeTenancyCount: 3 });
    await act(orgId, { kind: "changePlan", planId: "free", interval: "annual" });
    const sub = await subOf(orgId);
    expect(sub).toMatchObject({ planId: "free", status: "free", tenancyLimit: 2, activeTenancyCount: 3, priceToea: 0 });
    expect(canAddTenancy(sub as never)).toBe(false);
    expect((await adminDb().collection(`orgs/${orgId}/tenancies`).get()).size).toBe(3);
  });

  test("from free, it takes the next SUB- reference from the shared counter", async () => {
    const orgId = await paidOrg({ planId: "free", status: "free", paymentReference: null, priceToea: 0, tenancyLimit: 2 });
    const counter = adminDb().doc("private/subscriptionCounter");
    const n = (await counter.get()).get("nextReference") as number;
    await act(orgId, { kind: "changePlan", planId: "plus", interval: "annual" });
    const sub = await subOf(orgId);
    expect(sub).toMatchObject({ planId: "plus", priceToea: 100_000, tenancyLimit: 30 });
    expect(sub["paymentReference"]).toMatch(/^SUB-\d{4,}$/);
    expect(Number(String(sub["paymentReference"]).slice(4))).toBeGreaterThanOrEqual(n);
    expect((await counter.get()).get("nextReference")).toBeGreaterThan(Number(String(sub["paymentReference"]).slice(4)));
  });

  test("takes price and limit from plans/{planId} when it exists", async () => {
    await adminDb().doc("plans/plus").set({ name: "Plus", tenancyLimit: 30, priceToeaMonthly: 10_000, priceToeaAnnual: 100_000, public: true, order: 2 });
    const orgId = await paidOrg();
    await act(orgId, { kind: "changePlan", planId: "plus", interval: "monthly" });
    expect(await subOf(orgId)).toMatchObject({ priceToea: 10_000, interval: "monthly" });
  });
});

describe("every other action changes only what it names, and is audited", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>][] = [
    ["extendTrial", { trialEndsOn: "2027-03-20", status: "trial", paidThrough: null }, { kind: "extendTrial", days: 10 }, { trialEndsOn: "2027-03-30" }],
    ["setLimitOverride", {}, { kind: "setLimitOverride", limit: 25 }, { limitOverride: 25, tenancyLimit: 25 }],
    ["restrict", {}, { kind: "restrict" }, { manuallyRestricted: true, status: "restricted" }],
    ["unrestrict", { manuallyRestricted: true, status: "restricted" }, { kind: "unrestrict" }, { manuallyRestricted: false, status: "active" }],
    ["cancelSubscription", {}, { kind: "cancelSubscription" }, { status: "cancelled", cancelledOn: "2027-03-10", purgeAfter: "2027-06-08" }],
    ["reinstate", { status: "cancelled", cancelledOn: "2027-03-01", purgeAfter: "2027-05-30" }, { kind: "reinstate" }, { status: "active", cancelledOn: null, purgeAfter: null }],
  ];
  for (const [kind, start, action, changed] of cases) {
    test(kind, async () => {
      const orgId = await paidOrg(start);
      const before = await subOf(orgId);
      await act(orgId, action);
      const after = await subOf(orgId);
      expect(after).toEqual({ ...before, ...changed, updatedAt: Timestamp.fromDate(now) });
      const [event] = await eventsOf(orgId);
      expect(event).toMatchObject({ kind, orgId, actor: OP_UID, actorEmail: OPERATOR.email, after: changed });
      expect(Object.keys((event?.["before"] ?? {}) as object).sort()).toEqual(Object.keys(changed).sort());
    });
  }

  test("addNote writes the note and an audit entry; the subscription is untouched", async () => {
    const orgId = await paidOrg();
    const before = await subOf(orgId);
    await act(orgId, { kind: "addNote", text: "Rang Mary about April." });
    expect(await subOf(orgId)).toEqual(before);
    const notes = (await adminDb().collection(`subscriptions/${orgId}/notes`).get()).docs.map((d) => d.data());
    expect(notes).toEqual([{ text: "Rang Mary about April.", by: OP_UID, byEmail: OPERATOR.email, at: Timestamp.fromDate(now) }]);
    expect(await eventsOf(orgId)).toMatchObject([{ kind: "addNote", before: {}, after: {}, detail: { text: "Rang Mary about April." } }]);
  });
});
