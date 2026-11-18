/**
 * Enforcement (PLAN-SUBSCRIBERS S4; docs/test-lists/subscribers.md): a restricted org gets
 * no new month, and nothing else stops; the daily subscription tick keeps statuses and
 * counts true; the landlord asks to change plan.
 *
 * Orgs come from the real createOrg on 1 September 2026, a trial to 30 October.
 * `lapse` makes one restricted from 15 September: paid through 31 August, 14 days' grace.
 */
import { parsePeriod } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeBillingCallables } from "../src/callables/billing.js";
import { makeDraftNow } from "../src/callables/runs.js";
import type { Mail } from "../src/mail/mailer.js";
import { approveRun } from "../src/store/approval.js";
import { renderMissingPdfs } from "../src/store/pdfs.js";
import { draftRun } from "../src/store/runs.js";
import { storeOperatorAction } from "../src/store/subscriptions.js";
import { runSubscriptionTick, subscriptionTickAndLog } from "../src/subscriptionTick.js";
import { runTick, type TickDeps } from "../src/tick.js";
import { OPERATOR, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { anOrgWith, aSentMonth } from "./harness/seed.js";

const OCT = parsePeriod("2026-10");
const LEAD = new Date("2026-09-27T22:00:00Z"); // October's approval lead time begins
const SEND = new Date("2026-09-30T22:00:00Z"); // 8:00 am, 1 October
const REMIND = new Date("2026-10-14T14:00:00Z"); // October's reminders are due
const NOV_LATE = new Date("2026-11-02T00:00:00Z"); // after November's send time
const DAY = 86_400_000;
const RESTRICTED = "Your Sasimem subscription is restricted, so no new month can be drafted until payment arrives. Months already drafted carry on as normal. See Settings, Plan & billing.";

const sub = (orgId: string) => adminDb().doc(`subscriptions/${orgId}`);
const subOf = async (orgId: string) => (await sub(orgId).get()).data() ?? {};
const lapse = (orgId: string) => sub(orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2026-08-31" });
const eventsOf = async (orgId: string) => (await adminDb().collection("operatorEvents").where("orgId", "==", orgId).get()).docs.map((d) => d.data());

function clock(start: Date) {
  let now = start;
  const mailer = new FakeMailer();
  const deps: TickDeps = { now: () => now, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example" };
  return { deps, mailer, at: (t: Date) => { now = t; }, tick: (t: Date, orgIds: string[]) => { now = t; return runTick(deps, { orgIds }); } };
}

describe("the hourly tick and a restricted org (D5, PLAN-SUBSCRIBERS §2)", () => {
  test("does not draft for a restricted org, and counts it as skipped", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await lapse(orgId);
    const c = clock(LEAD);
    expect(await c.tick(LEAD, [orgId])).toMatchObject({ drafted: 0, skipped: 1 });
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).exists).toBe(false);
    expect(c.mailer.sent).toEqual([]);
  });

  test("restriction follows the dates the same hour, before the daily tick has written it", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await lapse(orgId);
    expect((await subOf(orgId))["status"]).toBe("active"); // stored status not yet caught up
    expect(await clock(LEAD).tick(LEAD, [orgId])).toMatchObject({ drafted: 0, skipped: 1 });
  });

  test("a cancelled org is skipped too; a past-due one still drafts", async () => {
    const cancelled = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await sub(cancelled.orgId).update({ status: "cancelled", cancelledOn: "2026-09-20", purgeAfter: "2026-12-19" });
    const pastDue = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await sub(pastDue.orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2026-09-20" });
    expect(await clock(LEAD).tick(LEAD, [cancelled.orgId, pastDue.orgId])).toMatchObject({ drafted: 1, skipped: 1 });
  });

  test("a run drafted before restriction is still asked for, sent, and reminded on", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    const c = clock(LEAD);
    expect(await c.tick(LEAD, [orgId])).toMatchObject({ drafted: 1, requested: 1 });
    await lapse(orgId);
    await approveRun(orgId, OCT, { actor: "uid", now: LEAD });
    await renderMissingPdfs(orgId, OCT);
    expect(await c.tick(SEND, [orgId])).toMatchObject({ sent: 1, skipped: 1 });
    expect(c.mailer.to("k1@tenant.example")).toHaveLength(1);
    expect(await c.tick(REMIND, [orgId])).toMatchObject({ reminded: 1, skipped: 1 });
  });

  test("a run drafted before restriction and never approved is held at its send time, as for anyone", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    const c = clock(LEAD);
    await c.tick(LEAD, [orgId]);
    await lapse(orgId);
    expect(await c.tick(SEND, [orgId])).toMatchObject({ held: 1 });
  });

  test("payment lifts it: the next tick drafts the month, held at once because its send time has passed", async () => {
    const { orgId } = await aSentMonth(); // October went out, so November late is an outage, not onboarding
    await lapse(orgId);
    const c = clock(NOV_LATE);
    expect(await c.tick(NOV_LATE, [orgId])).toMatchObject({ drafted: 0, skipped: 1 });
    const paid = await storeOperatorAction(orgId,
      { kind: "recordPayment", amountToea: 40_000, receivedOn: "2026-11-02" as never, bankReference: "BSP 778", months: 12 },
      { uid: "op", email: OPERATOR.email }, NOV_LATE);
    expect(paid).toMatchObject({ kind: "done", status: "active" });
    expect(await c.tick(new Date(NOV_LATE.getTime() + 3_600_000), [orgId])).toMatchObject({ drafted: 1, requested: 1, skipped: 0 });
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-11`).get()).get("status")).toBe("held");
  });
});

describe("draftNow and a restricted org", () => {
  const mailer = new FakeMailer();
  const draftNow = makeDraftNow({ now: () => LEAD, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example" });

  test("is refused with a plain message, and drafts nothing", async () => {
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await lapse(orgId);
    await expect(draftNow.run(request(uid, { orgId, period: "2026-10" }))).rejects.toMatchObject({ code: "failed-precondition", message: RESTRICTED });
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).exists).toBe(false);
  });

  test("a month drafted before restriction is not new: asking again answers as before", async () => {
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftRun(orgId, OCT, LEAD);
    await lapse(orgId);
    expect(await draftNow.run(request(uid, { orgId, period: "2026-10" }))).toMatchObject({ status: "awaitingApproval" });
  });
});

describe("the daily subscription tick (PLAN-SUBSCRIBERS §10, steps 1-2)", () => {
  const at = (t: Date) => ({ now: () => t, mailer: new FakeMailer(), appUrl: () => "https://sasimem.example", fallbackContact: () => "invoices@sasimem.example" });

  test("brings each stored status up to its dates, audited as subscription-tick", async () => {
    const { orgId } = await anOrgWith();
    const nov1 = new Date("2026-10-31T20:00:00Z"); // 06:00, 1 November, Port Moresby: the trial ended yesterday
    expect(await runSubscriptionTick(at(nov1), { orgIds: [orgId] })).toMatchObject({ checked: 1, changed: 1, recounted: 0 });
    expect(await subOf(orgId)).toMatchObject({ status: "past_due", updatedAt: Timestamp.fromDate(nov1) });
    expect(await eventsOf(orgId)).toEqual([{
      kind: "statusChange", orgId, actor: "subscription-tick", actorEmail: null, at: Timestamp.fromDate(nov1),
      before: { status: "trial" }, after: { status: "past_due" },
    }]);
    const nov14 = new Date(nov1.getTime() + 13 * DAY);
    await runSubscriptionTick(at(nov14), { orgIds: [orgId] });
    expect((await subOf(orgId))["status"]).toBe("restricted");
  });

  test("recounts the tenancies and corrects a drifted count, uncounting one whose end date has passed", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }, { id: "k2", endDate: "2026-09-30" }] });
    await sub(orgId).update({ activeTenancyCount: 9 });
    expect(await runSubscriptionTick(at(new Date("2026-10-05T20:00:00Z")), { orgIds: [orgId] })).toMatchObject({ recounted: 1 });
    expect((await subOf(orgId))["activeTenancyCount"]).toBe(1);
  });

  test("run twice in a day, the second changes and audits nothing", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await sub(orgId).update({ activeTenancyCount: 5 });
    const t = at(new Date("2026-10-31T20:00:00Z"));
    await runSubscriptionTick(t, { orgIds: [orgId] });
    const after = await subOf(orgId);
    expect(await runSubscriptionTick(t, { orgIds: [orgId] })).toMatchObject({ checked: 1, changed: 0, recounted: 0, emailed: 0 });
    expect(await subOf(orgId)).toEqual(after);
    expect(await eventsOf(orgId)).toHaveLength(1);
  });

  test("a hand restriction and a free plan are left as they are", async () => {
    const byHand = await anOrgWith();
    await sub(byHand.orgId).update({ status: "restricted", manuallyRestricted: true });
    const free = await anOrgWith();
    await sub(free.orgId).update({ planId: "free", status: "free", trialEndsOn: null });
    expect(await runSubscriptionTick(at(new Date("2026-10-05T20:00:00Z")), { orgIds: [byHand.orgId, free.orgId] })).toMatchObject({ changed: 0 });
  });

  test("logs one \"subscription tick done\" line for the alert", async () => {
    const { orgId } = await anOrgWith();
    const lines: [string, object][] = [];
    await subscriptionTickAndLog(at(new Date("2026-10-05T20:00:00Z")), { orgIds: [orgId] }, (m, d) => lines.push([m, d]));
    expect(lines).toEqual([["subscription tick done", expect.objectContaining({ event: "subscription_tick_done", checked: 1, changed: 0, recounted: 0 })]]);
  });
});

describe("asking to change plan (PLAN-SUBSCRIBERS §8)", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  class Box extends FakeMailer {
    refuse = false;
    override async send(mail: Mail) {
      if (this.refuse) throw new Error("Resend is down");
      return super.send(mail);
    }
  }
  const setUp = () => {
    const mailer = new Box();
    const { requestPlanChange } = makeBillingCallables({ now: () => now, mailer, fallbackContact: () => "invoices@sasimem.example" });
    return { mailer, ask: (uid: string, data: Record<string, unknown>) => requestPlanChange.run(request(uid, data, { email: "mary@wari.example" })) };
  };

  test("emails Sasimem with the org, the change and the message, replying to the landlord, and audits it", async () => {
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await adminDb().doc("sasimem/billing").set({ accountName: "Sasimem Ltd", bankName: "BSP", accountNumber: "1", contactEmail: "help@sasimem.example" });
    try {
      const { mailer, ask } = setUp();
      expect(await ask(uid, { orgId, planId: "plus", interval: "annual", message: " We are buying a block of flats. " }))
        .toEqual({ message: "Sasimem has your request and will reply to mary@wari.example." });
      const [mail] = mailer.sent;
      expect(mail).toMatchObject({ to: "help@sasimem.example", replyTo: "mary@wari.example", subject: "Plan change asked for: Wari Holdings" });
      const text = (mail?.text ?? "").replace(/\s+/g, " ");
      expect(text).toContain("asks to change from Standard, paid annually to Plus, paid annually. They use 0 of 10 tenancies.");
      expect(text).toContain("We are buying a block of flats.");
      expect(text).toContain(orgId);
      expect(await eventsOf(orgId)).toMatchObject([{ kind: "planChangeRequested", actor: uid, detail: { planId: "plus", interval: "annual", message: "We are buying a block of flats." } }]);
    } finally {
      await adminDb().doc("sasimem/billing").delete();
    }
  });

  test("once a day: a second ask the same day is refused and sends nothing", async () => {
    const { uid, orgId } = await anOrgWith();
    const { mailer, ask } = setUp();
    await ask(uid, { orgId, planId: "plus", interval: "annual" });
    await expect(ask(uid, { orgId, planId: "free", interval: "annual" })).rejects.toMatchObject({ code: "already-exists" });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("invoices@sasimem.example"); // no contact set: the sending address
  });

  test("a failed email frees the day's ask, so asking again sends it", async () => {
    const { uid, orgId } = await anOrgWith();
    const { mailer, ask } = setUp();
    mailer.refuse = true;
    await expect(ask(uid, { orgId, planId: "plus", interval: "annual" })).rejects.toMatchObject({ code: "aborted" });
    mailer.refuse = false;
    await ask(uid, { orgId, planId: "plus", interval: "annual" });
    expect(mailer.sent).toHaveLength(1);
  });

  test("refuses the plan already held, a made-up plan, and anyone but the owner", async () => {
    const { uid, orgId } = await anOrgWith();
    const { mailer, ask } = setUp();
    await expect(ask(uid, { orgId, planId: "standard", interval: "annual" })).rejects.toMatchObject({ message: "That is the plan you are on." });
    await expect(ask(uid, { orgId, planId: "gold", interval: "annual" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(ask("someone-else", { orgId, planId: "plus", interval: "annual" })).rejects.toMatchObject({ code: "permission-denied" });
    expect(mailer.sent).toEqual([]);
  });
});
