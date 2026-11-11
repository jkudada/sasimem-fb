/**
 * Lifecycle emails and the operator digest (PLAN-SUBSCRIBERS §9-§10, S5;
 * docs/test-lists/subscribers.md). Orgs come from the real createOrg on 1 September 2026,
 * a Standard trial to 30 October. Digest tests each use their own day: the digest is
 * claimed once per day for all of Sasimem.
 */
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { sendLifecycleNotices } from "../src/lifecycle.js";
import type { Mail } from "../src/mail/mailer.js";
import { draftRun } from "../src/store/runs.js";
import { runSubscriptionTick, type SubscriptionTickDeps } from "../src/subscriptionTick.js";
import { makeOnSubscriptionCreated } from "../src/triggers/welcome.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer } from "./harness/mailer.js";
import { anOrgWith } from "./harness/seed.js";

const LANDLORD = "mary@wari.example";
const SIGN_UP_DAY = new Date("2026-09-01T00:00:00Z"); // 10 am, 1 September, Port Moresby
const at6 = (day: string) => new Date(`${day}T06:00:00+10:00`);

class Box extends FakeMailer {
  refuse = false;
  override async send(mail: Mail) {
    if (this.refuse) throw new Error("Resend is down");
    return super.send(mail);
  }
}
function setUp() {
  const mailer = new Box();
  let now = SIGN_UP_DAY;
  const deps: SubscriptionTickDeps = { now: () => now, mailer, appUrl: () => "https://sasimem.example", fallbackContact: () => "ops@sasimem.example" };
  return {
    mailer, deps,
    tick: (t: Date, orgIds: string[]) => { now = t; return runSubscriptionTick(deps, { orgIds }); },
    send: (orgId: string, t: Date) => sendLifecycleNotices(deps, orgId, t),
  };
}
const sub = (orgId: string) => adminDb().doc(`subscriptions/${orgId}`);
const notices = async (orgId: string) => (await sub(orgId).collection("notices").get()).docs.map((d) => d.id).sort();
const emailLog = async (orgId: string) => (await adminDb().collection(`orgs/${orgId}/emails`).get()).docs.map((d) => d.data());

describe("lifecycle emails (PLAN-SUBSCRIBERS §9)", () => {
  test("the welcome goes when the subscription is made, once, logged, with the three steps", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    const s = setUp();
    const trigger = makeOnSubscriptionCreated({ ...s.deps, now: () => SIGN_UP_DAY });
    await trigger.run({ params: { orgId } } as never);
    await s.tick(at6("2026-09-02"), [orgId]); // the morning's catch-up finds it sent
    expect(s.mailer.to(LANDLORD).map((m) => m.subject)).toEqual(["Welcome to Sasimem"]);
    expect(s.mailer.to(LANDLORD)[0]?.text).toContain("1. Add each property and its units.");
    expect(s.mailer.to(LANDLORD)[0]?.text).toContain("Your free trial runs until 30 October 2026.");
    expect(await emailLog(orgId)).toMatchObject([{ kind: "welcome", to: LANDLORD, status: "sent" }]);
    expect(await notices(orgId)).toEqual(["welcome"]);
  });

  test("an org from before sign-ups were dated, or signed up long ago, is welcomed by nobody", async () => {
    const { orgId } = await anOrgWith();
    await sub(orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2031-12-31" });
    const s = setUp();
    expect(await s.send(orgId, at6("2026-11-05"))).toBe(0);
    await adminDb().doc(`orgs/${orgId}`).update({ createdAt: null });
    expect(await s.send(orgId, SIGN_UP_DAY)).toBe(0);
    expect(s.mailer.sent).toEqual([]);
  });

  test("the setup nudge goes once, three days in, while there is no tenancy", async () => {
    const empty = await anOrgWith();
    const busy = await anOrgWith({ tenancies: [{ id: "k1" }] });
    const s = setUp();
    await sub(empty.orgId).collection("notices").doc("welcome").create({ at: SIGN_UP_DAY });
    await sub(busy.orgId).collection("notices").doc("welcome").create({ at: SIGN_UP_DAY });
    await s.tick(at6("2026-09-04"), [empty.orgId, busy.orgId]);
    await s.tick(at6("2026-09-05"), [empty.orgId, busy.orgId]);
    expect(s.mailer.sent.map((m) => m.subject)).toEqual(["Add your first tenancy to start invoicing"]);
  });

  test("two ticks at once send a trial reminder once, and it names the amount, reference and how to pay", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    const s = setUp();
    await Promise.all([s.send(orgId, at6("2026-10-16")), s.send(orgId, at6("2026-10-16"))]);
    await s.send(orgId, at6("2026-10-20"));
    expect(s.mailer.to(LANDLORD)).toHaveLength(1);
    const mails = s.mailer.to(LANDLORD);
    expect(mails.map((m) => m.subject)).toEqual(["Your free trial ends on 30 October 2026"]);
    expect(mails[0]?.text).toMatch(/Pay K400\.00 for a year, with the\s+reference SUB-\d{4,}/);
    expect(mails[0]?.text).toContain("https://sasimem.example/settings/billing");
    expect(await notices(orgId)).toEqual(["trialEnding14_2026-10-30"]);
  });

  test("past due, then restricted: each once, saying what changes", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await sub(orgId).collection("notices").doc("trialEnding3_2026-10-30").create({ at: SIGN_UP_DAY });
    const s = setUp();
    for (const day of ["2026-10-31", "2026-11-01", "2026-11-13", "2026-11-14", "2026-11-15"]) await s.send(orgId, at6(day));
    const mails = s.mailer.to(LANDLORD);
    expect(mails.map((m) => m.subject)).toEqual(["Your Sasimem payment is overdue", "Your Sasimem subscription is restricted"]);
    expect(mails[1]?.text.replace(/\s+/g, " ")).toContain("Invoices already approved are sent as normal.");
    expect((await emailLog(orgId)).map((e) => e["kind"]).sort()).toEqual(["pastDue", "restricted"]);
  });

  test("a failed send leaves the claim unwritten, so the next tick sends it", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    const s = setUp();
    s.mailer.refuse = true;
    await expect(s.tick(at6("2026-10-16"), [orgId])).rejects.toThrow("Resend is down");
    expect(await notices(orgId)).toEqual([]);
    expect(await emailLog(orgId)).toMatchObject([{ kind: "trialEnding", status: "failed" }]);
    s.mailer.refuse = false;
    expect(await s.tick(at6("2026-10-17"), [orgId])).toMatchObject({ emailed: 1 });
    expect(await notices(orgId)).toEqual(["trialEnding14_2026-10-30"]);
  });
});

describe("the operator digest (PLAN-SUBSCRIBERS §9)", () => {
  test("is not sent on a day with nothing to report", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await sub(orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2031-12-31" });
    const s = setUp();
    expect(await s.tick(at6("2031-03-03"), [orgId])).toMatchObject({ digest: 0 });
    expect(s.mailer.sent).toEqual([]);
    expect((await adminDb().doc("operatorDigests/2031-03-03").get()).exists).toBe(false);
  });

  test("tells Sasimem who is past due, restricted, held and bounced, once a day, at the contact address", async () => {
    const day = "2031-04-02";
    const pastDue = await anOrgWith({ tenancies: [{ id: "k1" }], org: { name: "Kila Trading" } });
    await sub(pastDue.orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2031-03-31" });
    const restricted = await anOrgWith({ tenancies: [{ id: "k1" }], org: { name: "Boroko Flats" } });
    await sub(restricted.orgId).update({ status: "restricted", manuallyRestricted: true });
    const held = await anOrgWith({ tenancies: [{ id: "k1" }], org: { name: "Gerehu Homes" } });
    await sub(held.orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2031-12-31" });
    await draftRun(held.orgId, "2026-10" as never, SIGN_UP_DAY);
    await adminDb().doc(`orgs/${held.orgId}/runs/2026-10`).update({ status: "held" });
    await adminDb().collection(`orgs/${held.orgId}/emails`).add({ kind: "reminder", to: "x@bad.example", status: "failed", error: "bounced", sentAt: Timestamp.fromDate(new Date(at6(day).getTime() - 3_600_000)) });
    await adminDb().doc("sasimem/billing").set({ accountName: "Sasimem Ltd", bankName: "BSP", accountNumber: "1", contactEmail: "help@sasimem.example" });
    try {
      const s = setUp();
      const orgIds = [pastDue.orgId, restricted.orgId, held.orgId];
      expect(await s.tick(at6(day), orgIds)).toMatchObject({ digest: 1 });
      expect(await s.tick(at6(day), orgIds)).toMatchObject({ digest: 0 });
      const digests = s.mailer.to("help@sasimem.example");
      expect(digests.map((m) => m.subject)).toEqual(["Sasimem today, 2 April 2031"]);
      const text = digests[0]?.text.replace(/\s+/g, " ") ?? "";
      expect(text).toContain("Past due (1): Kila Trading: unpaid since 1 April 2031, restricted from 15 April 2031, K400.00 annual");
      expect(text).toContain("Restricted (1): Boroko Flats: restricted by hand");
      expect(text).toContain("Held runs (1): Gerehu Homes: 2026-10, waiting for approval");
      expect(text).toContain("Emails that failed yesterday (1): Gerehu Homes: reminder to x@bad.example: bounced");
    } finally {
      await adminDb().doc("sasimem/billing").delete();
    }
  });

  test("lists a new sign-up the next morning", async () => {
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await adminDb().doc(`orgs/${orgId}`).update({ createdAt: Timestamp.fromDate(new Date("2031-05-05T03:00:00Z")) });
    await sub(orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2031-12-31" });
    await sub(orgId).collection("notices").doc("welcome").create({ at: SIGN_UP_DAY });
    const s = setUp();
    await s.tick(at6("2031-05-06"), [orgId]);
    expect(s.mailer.to("ops@sasimem.example")[0]?.text.replace(/\s+/g, " ")).toContain(`New sign-ups (1): Wari Holdings: ${LANDLORD}, standard`);
  });
});
