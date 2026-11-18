import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeCreateOrg } from "../src/callables/createOrg.js";
import { makeOperatorCallables } from "../src/callables/operator.js";
import { newUser, OPERATOR, request, typedOrg } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer } from "./harness/mailer.js";

const now = new Date("2027-03-10T01:00:00Z"); // 10 March in Port Moresby
const mailer = new FakeMailer();
const { invite } = makeOperatorCallables({ now: () => now, mailer, appUrl: () => "https://app.example" });
const createOrg = makeCreateOrg({ now: () => now, signupMode: () => "invite" });
const send = (o: Record<string, unknown> = {}) => ({ kind: "send", email: `${crypto.randomUUID()}@wari.example`, planId: "standard", trialDays: 30, expiresInDays: 14, ...o });
const asOperator = (data: unknown) => invite.run(request("operator-joe", data, OPERATOR));
const inviteOf = async (email: string) => (await adminDb().doc(`signupInvites/${email}`).get()).data();
const signUp = async (email: string) => {
  const uid = await newUser({ email });
  return { uid, run: () => createOrg.run(request(uid, typedOrg)) };
};

describe("inviting a subscriber (PLAN-SUBSCRIBERS S3)", () => {
  test("only an operator with their code can invite", async () => {
    await expect(invite.run(request("mary", send(), { email: "mary@wari.example" }))).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("creates the invitation with its plan, trial and expiry, emails the sign-up link, and audits it", async () => {
    const s = send();
    expect(await asOperator(s)).toEqual({ emailed: true });
    expect(await inviteOf(s.email)).toEqual({
      planId: "standard", trialDays: 30, expiresAt: Timestamp.fromDate(new Date("2027-03-24T01:00:00Z")),
      invitedAt: Timestamp.fromDate(now), invitedBy: "operator-joe", invitedByEmail: OPERATOR.email,
      usedBy: null, lastSentAt: Timestamp.fromDate(now), sendCount: 1, lastError: null,
    });
    const [mail] = mailer.to(s.email);
    expect(mail?.subject).toBe("You are invited to Sasimem");
    expect(mail?.text).toContain("https://app.example/sign-up");
    expect(mail?.text).toContain("a 30-day trial of Standard");
    expect(mail?.text).toContain("24 March 2027");
    const events = (await adminDb().collection("operatorEvents").where("detail.email", "==", s.email).get()).docs.map((d) => d.data());
    expect(events).toMatchObject([{ kind: "invite", actor: "operator-joe", detail: { email: s.email, planId: "standard", trialDays: 30 } }]);
  });

  test("sending again re-sends it with the new terms, keeping when it was first made", async () => {
    const s = send();
    await asOperator(s);
    await asOperator({ ...s, planId: "free" });
    expect(await inviteOf(s.email)).toMatchObject({ planId: "free", trialDays: 0, sendCount: 2, invitedAt: Timestamp.fromDate(now) });
    expect(mailer.to(s.email)).toHaveLength(2);
  });

  test("a used invitation cannot be changed or revoked", async () => {
    const s = send();
    await adminDb().doc(`signupInvites/${s.email}`).set({ invitedAt: now, usedBy: "someone", usedAt: now });
    await expect(asOperator(s)).rejects.toMatchObject({ code: "failed-precondition", message: "That invitation has been used: the subscriber has signed up." });
    await expect(asOperator({ kind: "revoke", email: s.email })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("revoking deletes an unused invitation", async () => {
    const s = send();
    await asOperator(s);
    expect(await asOperator({ kind: "revoke", email: s.email })).toEqual({ emailed: false });
    expect(await inviteOf(s.email)).toBeUndefined();
    await expect(asOperator({ kind: "revoke", email: s.email })).rejects.toMatchObject({ code: "not-found" });
  });

  test("a failed email leaves the invitation in place and says the email failed", async () => {
    const s = send();
    mailer.refusing = true;
    try {
      await expect(asOperator(s)).rejects.toMatchObject({ code: "aborted", message: "The invitation is saved, but its email could not be sent. Try sending it again in a few minutes." });
    } finally {
      mailer.refusing = false;
    }
    expect(await inviteOf(s.email)).toMatchObject({ planId: "standard", sendCount: 0, lastError: expect.stringContaining("refused") });
  });
});

describe("signing up with an invitation", () => {
  test("gives the invitation's plan and trial length", async () => {
    const s = send({ planId: "plus", trialDays: 30 });
    await asOperator(s);
    const { orgId } = await (await signUp(s.email)).run();
    expect((await adminDb().doc(`subscriptions/${orgId}`).get()).data()).toMatchObject({
      planId: "plus", status: "trial", trialEndsOn: "2027-04-08", priceToea: 100_000, tenancyLimit: 30,
    });
  });

  test("a free invitation gives a free subscription: no trial, no reference", async () => {
    const s = send({ planId: "free" });
    await asOperator(s);
    const counter = adminDb().doc("private/subscriptionCounter");
    const before = (await counter.get()).get("nextReference");
    const { orgId } = await (await signUp(s.email)).run();
    expect((await adminDb().doc(`subscriptions/${orgId}`).get()).data()).toMatchObject({
      planId: "free", status: "free", trialEndsOn: null, paymentReference: null, tenancyLimit: 2, activeTenancyCount: 0,
    });
    expect((await counter.get()).get("nextReference")).toBe(before);
  });

  test("an invitation from ops/invite.ts, with no plan, gives the standard 60-day trial", async () => {
    const email = `${crypto.randomUUID()}@wari.example`;
    await adminDb().doc(`signupInvites/${email}`).set({ invitedAt: now });
    const { orgId } = await (await signUp(email)).run();
    expect((await adminDb().doc(`subscriptions/${orgId}`).get()).data()).toMatchObject({ planId: "standard", status: "trial", trialEndsOn: "2027-05-08" });
  });

  test("an expired invitation is refused, and nothing is written", async () => {
    const email = `${crypto.randomUUID()}@wari.example`;
    await adminDb().doc(`signupInvites/${email}`).set({ invitedAt: now, planId: "standard", trialDays: 60, expiresAt: new Date("2027-03-10T00:59:59Z") });
    const { uid, run } = await signUp(email);
    await expect(run()).rejects.toMatchObject({ code: "permission-denied" });
    expect((await adminDb().doc(`users/${uid}`).get()).exists).toBe(false);
    expect((await inviteOf(email))?.["usedBy"]).toBeUndefined();
  });
});
