import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeCreateOrg } from "../src/callables/createOrg.js";
import { newUser, request, typedOrg } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";

const now = new Date("2026-09-20T01:00:00Z");
const createOrg = makeCreateOrg({ now: () => now, signupMode: () => "open" });

describe("createOrg", () => {
  test("creates the organisation with the plan's defaults, its owner, the user's org list and the custom claim", async () => {
    const uid = await newUser();
    const { orgId } = await createOrg.run(request(uid, typedOrg));

    const org = await adminDb().doc(`orgs/${orgId}`).get();
    expect(org.data()).toEqual({
      ...typedOrg,
      invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby", approvalLeadDays: 3, sendHour: 8,
      reminderAfterDays: 7, reminderMode: "auto", createdAt: Timestamp.fromDate(now),
    });
    expect((await adminDb().doc(`orgs/${orgId}/members/${uid}`).get()).data()).toEqual({ role: "owner", addedAt: Timestamp.fromDate(now) });
    expect((await adminDb().doc(`users/${uid}`).get()).data()).toEqual({ orgIds: [orgId] });
    expect((await getAuth().getUser(uid)).customClaims).toEqual({ orgIds: [orgId] });
  });

  test("a second call by the same user returns the same organisation and creates nothing new (one org per user, safe to retry)", async () => {
    const uid = await newUser();
    const first = await createOrg.run(request(uid, typedOrg));
    const second = await createOrg.run(request(uid, { ...typedOrg, name: "Another Name" }));
    expect(second.orgId).toBe(first.orgId);
    expect((await adminDb().doc(`orgs/${first.orgId}`).get()).get("name")).toBe("Wari Holdings");
    expect((await adminDb().doc(`users/${uid}`).get()).data()).toEqual({ orgIds: [first.orgId] });
  });

  test("refuses an invalid profile with core's plain-English message, and writes nothing", async () => {
    const uid = await newUser();
    await expect(createOrg.run(request(uid, { ...typedOrg, gstRegistered: true, gstNumber: "" }))).rejects.toMatchObject({
      code: "invalid-argument",
      message: "A GST-registered landlord must enter their GST number: it is printed on every tax invoice.",
      details: { problems: { gstNumber: "A GST-registered landlord must enter their GST number: it is printed on every tax invoice." } },
    });
    expect((await adminDb().doc(`users/${uid}`).get()).exists).toBe(false);
  });

  test("refuses data that is not an organisation at all", async () => {
    const uid = await newUser();
    await expect(createOrg.run(request(uid, { name: 42 } as never))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(createOrg.run(request(uid, { ...typedOrg, firstInvoiceNumber: 1.5 }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect((await adminDb().doc(`users/${uid}`).get()).exists).toBe(false);
  });

  test("refuses a caller who is not signed in", async () => {
    await expect(createOrg.run(request(null, typedOrg))).rejects.toMatchObject({ code: "unauthenticated", message: "Sign in first." });
  });

  test("seeds the server-only counter from the first invoice number, 1 unless the landlord says otherwise", async () => {
    const fresh = await createOrg.run(request(await newUser(), typedOrg));
    expect((await adminDb().doc(`orgs/${fresh.orgId}/private/counter`).get()).data()).toEqual({ nextInvoiceNumber: 1 });
    const continuing = await createOrg.run(request(await newUser(), { ...typedOrg, firstInvoiceNumber: 142 }));
    expect((await adminDb().doc(`orgs/${continuing.orgId}/private/counter`).get()).data()).toEqual({ nextInvoiceNumber: 142 });
  });
});

describe("sign-up (docs/PLAN-TEMPLATES.md §7)", () => {
  const invited = makeCreateOrg({ now: () => now, signupMode: () => "invite" });
  const invite = (email: string) => adminDb().doc(`signupInvites/${email.toLowerCase()}`).set({ invitedAt: now });

  test("in invite mode, an email with no invitation is refused with a clear message, and nothing is written", async () => {
    const uid = await newUser();
    await expect(invited.run(request(uid, typedOrg))).rejects.toMatchObject({
      code: "permission-denied", message: "Sign-up is by invitation for now. Ask Sasimem for an invitation for this email address.",
    });
    expect((await adminDb().doc(`users/${uid}`).get()).exists).toBe(false);
  });

  test("in invite mode, an invited, verified email creates its org and uses the invitation up", async () => {
    const email = `Mary.${crypto.randomUUID()}@Wari.example`;
    const uid = await newUser({ email });
    await invite(email); // invitations are kept lower-case; the sign-up's case does not matter
    const { orgId } = await invited.run(request(uid, typedOrg));
    expect(orgId).toMatch(/.+/);
    expect((await adminDb().doc(`signupInvites/${email.toLowerCase()}`).get()).data()).toMatchObject({ usedBy: uid, usedAt: Timestamp.fromDate(now) });
    expect((await invited.run(request(uid, typedOrg))).orgId).toBe(orgId); // a retry still gets its org
  });

  test("an invitation makes one organisation: a used one is refused to anyone else", async () => {
    const email = `${crypto.randomUUID()}@wari.example`;
    await invite(email);
    await adminDb().doc(`signupInvites/${email}`).update({ usedBy: "someone-else", usedAt: now });
    await expect(invited.run(request(await newUser({ email }), typedOrg))).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("an unverified email is refused in either mode, saying what to do", async () => {
    const email = `${crypto.randomUUID()}@wari.example`;
    await invite(email);
    const uid = await newUser({ email, verified: false });
    for (const call of [invited, createOrg]) {
      await expect(call.run(request(uid, typedOrg))).rejects.toMatchObject({
        code: "failed-precondition", message: "Confirm your email address first: open the link we emailed you, then try again.",
      });
    }
    expect((await adminDb().doc(`signupInvites/${email}`).get()).get("usedBy")).toBeUndefined();
  });

  test("in open mode, any verified email creates an org, with no invitation", async () => {
    expect((await createOrg.run(request(await newUser(), typedOrg))).orgId).toMatch(/.+/);
  });

  test("the deployed setting: only \"open\" opens sign-up; anything else, a typo included, means invite", async () => {
    const { signupModeOf } = await import("../src/params.js");
    expect(["open", "invite", "", "Open", "opne"].map(signupModeOf)).toEqual(["open", "invite", "invite", "invite", "invite"]);
  });
});
