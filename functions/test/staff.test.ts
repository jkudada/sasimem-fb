/** Staff management and settings (docs/PLAN-ADMIN-DASHBOARD.md §5, §9, A1; docs/test-lists/admin-dashboard.md). */
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeCreateOrg, STAFF_EMAIL } from "../src/callables/createOrg.js";
import { EMAIL_FAILED, LANDLORD_EMAIL, makeStaffCallables, staffClaims } from "../src/callables/staff.js";
import { asStaff, newUser, request, typedOrg } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer } from "./harness/mailer.js";

const now = new Date("2027-03-10T01:00:00Z");
const mailer = new FakeMailer();
const { manageStaff, updateSettings } = makeStaffCallables({ now: () => now, mailer, consoleUrl: () => "https://console.example" });

const id = (role: string) => `${role}-${crypto.randomUUID().slice(0, 8)}`;
/** A member of staff with an Auth user of their own (so claims and tokens can be checked), and how they call. */
async function staff(role: string, status = "active") {
  const email = `${id(role)}@sasimem.example`;
  const uid = await newUser({ email });
  const claims = { ...(await asStaff(uid, role, status)), email };
  await adminDb().doc(`staff/${uid}`).update({ email });
  return {
    uid, email,
    manage: (data: Record<string, unknown>) => manageStaff.run(request(uid, data, claims)),
    settings: (data: Record<string, unknown>) => updateSettings.run(request(uid, data, claims)),
  };
}
const record = async (uid: string) => (await adminDb().doc(`staff/${uid}`).get()).data();
const claimsOf = async (uid: string) => (await getAuth().getUser(uid)).customClaims ?? {};
const eventsAbout = async (uid: string) =>
  (await adminDb().collection("operatorEvents").where("staffUid", "==", uid).get()).docs.map((d) => d.data()).sort((a, b) => String(a["kind"]).localeCompare(String(b["kind"])));
const newEmail = () => `${id("new")}@sasimem.example`;
const invite = (email: string, role: string) => ({ kind: "invite", email, role, displayName: "Ann Kila" });
const setSettings = (o: Record<string, unknown>) => adminDb().doc("console/settings").set(o);

describe("who manages staff", () => {
  test("Supervisors, Support and Viewers cannot list or invite; nothing is made", async () => {
    for (const role of ["supervisor", "support", "viewer"]) {
      const s = await staff(role);
      const email = newEmail();
      await expect(s.manage({ kind: "list" })).rejects.toMatchObject({ code: "permission-denied", message: "Only an Owner or a Manager can manage staff." });
      await expect(s.manage(invite(email, "viewer"))).rejects.toMatchObject({ code: "permission-denied" });
      await expect(getAuth().getUserByEmail(email)).rejects.toMatchObject({ code: "auth/user-not-found" });
    }
  });

  test("a landlord, or staff without their code, is refused", async () => {
    await expect(manageStaff.run(request("mary", { kind: "list" }, { email: "mary@wari.example" }))).rejects.toMatchObject({ code: "permission-denied" });
    const s = await staff("owner");
    await expect(manageStaff.run(request(s.uid, { kind: "list" }, { email: s.email, firebase: { sign_in_provider: "password" } }))).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("the list shows each person's role, standing and whether their code is set up", async () => {
    const owner = await staff("owner");
    const viewer = await staff("viewer");
    const { staff: rows } = await owner.manage({ kind: "list" });
    expect(rows?.find((r) => r.uid === viewer.uid)).toMatchObject({ email: viewer.email, role: "viewer", status: "active", codeSetUp: false, lastSeenAt: null });
  });
});

describe("inviting", () => {
  test("an Owner invites a Manager: an account, the staff record, the claim, an audit entry, and an email with the set-password link", async () => {
    const owner = await staff("owner");
    const email = newEmail();
    expect(await owner.manage(invite(` ${email.toUpperCase()} `, "manager"))).toEqual({ emailed: true });
    const user = await getAuth().getUserByEmail(email);
    expect(user.displayName).toBe("Ann Kila");
    expect(user.customClaims).toEqual({ staffRole: "manager" });
    expect(await record(user.uid)).toMatchObject({
      role: "manager", status: "active", email, displayName: "Ann Kila", invitedBy: owner.uid, lastSeenAt: null, createdAt: Timestamp.fromDate(now),
    });
    expect(await eventsAbout(user.uid)).toEqual([{
      kind: "staffInvited", actor: owner.uid, actorEmail: owner.email, actorRole: "owner", at: Timestamp.fromDate(now),
      staffUid: user.uid, staffEmail: email, before: {}, after: { role: "manager", status: "active" },
    }]);
    const [mail] = mailer.to(email);
    expect(mail?.subject).toBe("Your Sasimem console account");
    expect(mail?.text).toContain("as Manager");
    expect(mail?.text).toContain("mode=resetPassword");
    expect(mail?.text).toContain(encodeURIComponent("https://console.example"));
  });

  test("a Manager invites Supervisors, Support and Viewers, never an Owner or a Manager", async () => {
    const manager = await staff("manager");
    await expect(manager.manage(invite(newEmail(), "support"))).resolves.toEqual({ emailed: true });
    const email = newEmail();
    await expect(manager.manage(invite(email, "manager"))).rejects.toMatchObject({ code: "permission-denied", message: "Only an Owner can add, change or remove an Owner or a Manager." });
    await expect(getAuth().getUserByEmail(email)).rejects.toMatchObject({ code: "auth/user-not-found" });
  });

  test("a landlord's email is refused while staff emails are kept separate (S5), and allowed once that is off", async () => {
    const owner = await staff("owner");
    const email = newEmail();
    const landlord = await newUser({ email });
    await getAuth().setCustomUserClaims(landlord, { orgIds: ["org-1"] });
    await setSettings({ staffEmailSeparate: true });
    await expect(owner.manage(invite(email, "viewer"))).rejects.toMatchObject({ code: "failed-precondition", message: LANDLORD_EMAIL });
    expect(await record(landlord)).toBeUndefined();
    await setSettings({ staffEmailSeparate: false });
    try {
      await owner.manage(invite(email, "viewer"));
      expect(await claimsOf(landlord)).toEqual({ orgIds: ["org-1"], staffRole: "viewer" });
    } finally {
      await setSettings({ staffEmailSeparate: true });
    }
  });

  test("inviting someone already on staff is refused; someone removed can be invited again", async () => {
    const owner = await staff("owner");
    const v = await staff("viewer");
    await expect(owner.manage(invite(v.email, "support"))).rejects.toMatchObject({ code: "failed-precondition", message: "That person is already staff. Change their role instead." });
    await owner.manage({ kind: "remove", uid: v.uid });
    await owner.manage(invite(v.email, "support"));
    expect(await record(v.uid)).toMatchObject({ role: "support", status: "active" });
  });

  test("when the email cannot be sent, the access is kept and Send again works", async () => {
    const owner = await staff("owner");
    const email = newEmail();
    mailer.refusing = true;
    try {
      await expect(owner.manage(invite(email, "viewer"))).rejects.toMatchObject({ code: "aborted", message: EMAIL_FAILED });
    } finally {
      mailer.refusing = false;
    }
    const { uid } = await getAuth().getUserByEmail(email);
    expect(await record(uid)).toMatchObject({ status: "active", role: "viewer" });
    expect(await owner.manage({ kind: "resendInvite", uid })).toEqual({ emailed: true });
    expect(mailer.to(email)).toHaveLength(1);
  });
});

describe("changing someone's access", () => {
  test("suspending marks the record (which the rules read at once) and drops the claim; reactivating restores it; both audited", async () => {
    const owner = await staff("owner");
    const s = await staff("supervisor");
    await getAuth().setCustomUserClaims(s.uid, { staffRole: "supervisor" });
    await owner.manage({ kind: "suspend", uid: s.uid });
    expect(await record(s.uid)).toMatchObject({ status: "suspended", updatedAt: Timestamp.fromDate(now) });
    expect(await claimsOf(s.uid)).toEqual({});
    // Suspended, they can do nothing, not even sign themselves out everywhere.
    await expect(s.manage({ kind: "signOutEverywhere" })).rejects.toMatchObject({ code: "permission-denied" });
    await owner.manage({ kind: "reactivate", uid: s.uid });
    expect(await claimsOf(s.uid)).toEqual({ staffRole: "supervisor" });
    expect((await eventsAbout(s.uid)).map((e) => [e["kind"], e["after"]])).toEqual([
      ["staffReactivated", { role: "supervisor", status: "active" }],
      ["staffSuspended", { role: "supervisor", status: "suspended" }],
    ]);
  });

  test("changing a role sets the new claim; a Manager cannot touch an Owner; nobody changes themselves", async () => {
    const owner = await staff("owner");
    const manager = await staff("manager");
    const v = await staff("viewer");
    await manager.manage({ kind: "changeRole", uid: v.uid, role: "support" });
    expect(await record(v.uid)).toMatchObject({ role: "support" });
    expect(await claimsOf(v.uid)).toEqual({ staffRole: "support" });
    await expect(manager.manage({ kind: "suspend", uid: owner.uid })).rejects.toMatchObject({ code: "failed-precondition", message: "Only an Owner can add, change or remove an Owner or a Manager." });
    await expect(owner.manage({ kind: "changeRole", uid: owner.uid, role: "viewer" })).rejects.toMatchObject({ code: "failed-precondition", message: "You cannot change your own access. Ask another Owner." });
    expect(await record(owner.uid)).toMatchObject({ role: "owner", status: "active" });
  });

  test("resetting the code removes their authenticator and ends their sessions; audited", async () => {
    const owner = await staff("owner");
    const v = await staff("viewer");
    await owner.manage({ kind: "resetMfa", uid: v.uid });
    expect((await getAuth().getUser(v.uid)).multiFactor?.enrolledFactors ?? []).toEqual([]);
    expect((await eventsAbout(v.uid)).map((e) => e["kind"])).toEqual(["staffMfaReset"]);
  });

  test("anyone signs themselves out everywhere", async () => {
    const v = await staff("viewer");
    await expect(v.manage({ kind: "signOutEverywhere" })).resolves.toEqual({});
    expect((await eventsAbout(v.uid)).map((e) => e["kind"])).toEqual(["staffSignedOutEverywhere"]);
  });

  test("a malformed action is refused with core's words", async () => {
    const owner = await staff("owner");
    await expect(owner.manage({ kind: "invite", email: "nope", role: "viewer", displayName: "A" })).rejects.toMatchObject({ code: "invalid-argument", message: "Enter their email address, like name@example.com." });
  });
});

test("the claims keep a landlord's orgIds and drop the old operator claim", () => {
  expect(staffClaims({ orgIds: ["o1"], operator: true }, "owner")).toEqual({ orgIds: ["o1"], staffRole: "owner" });
  expect(staffClaims({ orgIds: ["o1"], staffRole: "owner" }, null)).toEqual({ orgIds: ["o1"] });
  expect(staffClaims(undefined, "viewer")).toEqual({ staffRole: "viewer" });
});

describe("settings (§5)", () => {
  test("the Owner switches Managers' view of names on: stored, and audited with before and after", async () => {
    await setSettings({});
    const owner = await staff("owner");
    expect(await owner.settings({ managersSeeNames: true })).toEqual({ ok: true });
    expect((await adminDb().doc("console/settings").get()).data()).toMatchObject({
      managersSeeNames: true, showRentVolume: true, viewAsEnabled: false, summaryRecipients: null, staffEmailSeparate: true, updatedBy: owner.uid,
    });
    const [event] = (await adminDb().collection("operatorEvents").where("kind", "==", "settingChanged").where("actor", "==", owner.uid).get()).docs.map((d) => d.data());
    expect(event).toMatchObject({ actorRole: "owner", before: { managersSeeNames: false }, after: { managersSeeNames: true } });
    await setSettings({});
  });

  test("a Manager turns rent volume off, but cannot allow view-as or change the summary list", async () => {
    const manager = await staff("manager");
    await expect(manager.settings({ showRentVolume: false })).resolves.toEqual({ ok: true });
    await expect(manager.settings({ viewAsEnabled: true })).rejects.toMatchObject({ code: "permission-denied", message: "Only an Owner can change that setting." });
    await expect(manager.settings({ summaryRecipients: [manager.uid] })).rejects.toMatchObject({ code: "permission-denied" });
    const viewer = await staff("viewer");
    await expect(viewer.settings({ showRentVolume: true })).rejects.toMatchObject({ code: "permission-denied", message: "Only an Owner or Manager can change that setting." });
    await setSettings({});
  });

  test("summary recipients must be active staff", async () => {
    const owner = await staff("owner");
    const manager = await staff("manager");
    const gone = await staff("manager", "suspended");
    await expect(owner.settings({ summaryRecipients: [manager.uid, gone.uid] })).rejects.toMatchObject({ code: "failed-precondition", message: "Choose people who are active staff." });
    await expect(owner.settings({ summaryRecipients: [manager.uid, owner.uid] })).resolves.toEqual({ ok: true });
    await expect(owner.settings({ colour: "red" })).rejects.toMatchObject({ code: "invalid-argument" });
    await setSettings({});
  });
});

test("a staff account cannot make a landlord organisation while the setting keeps them apart (S5)", async () => {
  const createOrg = makeCreateOrg({ now: () => now, signupMode: () => "open" });
  const v = await staff("viewer");
  await setSettings({});
  await expect(createOrg.run(request(v.uid, typedOrg))).rejects.toMatchObject({ code: "failed-precondition", message: STAFF_EMAIL });
});
