import { describe, expect, test } from "vitest";
import * as s from "./staff.js";
import type { StaffMember, StaffRole } from "./staff.js";

const D = s.DEFAULT_SETTINGS;
const problemOf = (r: object): string | null => ("problem" in r ? (r as { problem: string }).problem : null);
const member = (uid: string, role: StaffRole, status: s.StaffStatus = "active"): StaffMember => ({ uid, role, status });

describe("settings (PLAN-ADMIN-DASHBOARD §5)", () => {
  test("defaults: Managers see no names, rent volume shown, no view-as, summary to every Manager, staff emails kept separate", () => {
    expect(D).toEqual({ managersSeeNames: false, showRentVolume: true, viewAsEnabled: false, summaryRecipients: null, staffEmailSeparate: true });
  });

  test("a missing or malformed document reads as the defaults, key by key", () => {
    expect(s.settingsFrom(undefined)).toEqual(D);
    expect(s.settingsFrom(null)).toEqual(D);
    expect(s.settingsFrom({ managersSeeNames: "yes", showRentVolume: false, summaryRecipients: [1] })).toEqual({ ...D, showRentVolume: false });
    expect(s.settingsFrom({ managersSeeNames: true, viewAsEnabled: true, staffEmailSeparate: false, summaryRecipients: ["u1", "u2"] }))
      .toEqual({ managersSeeNames: true, showRentVolume: true, viewAsEnabled: true, staffEmailSeparate: false, summaryRecipients: ["u1", "u2"] });
  });

  test("a change names known keys with values of the right type; recipients lose duplicates", () => {
    expect(s.settingsChangeFrom({ showRentVolume: false })).toEqual({ showRentVolume: false });
    expect(s.settingsChangeFrom({ summaryRecipients: ["a", "b", "a"] })).toEqual({ summaryRecipients: ["a", "b"] });
    expect(s.settingsChangeFrom({ summaryRecipients: null, viewAsEnabled: true })).toEqual({ summaryRecipients: null, viewAsEnabled: true });
  });

  test("anything else is refused", () => {
    for (const bad of [null, "x", [], { colour: "red" }, { showRentVolume: "no" }, { summaryRecipients: "u1" }, { summaryRecipients: ["has/slash"] }, { summaryRecipients: [""] }]) {
      expect(problemOf(s.settingsChangeFrom(bad)), JSON.stringify(bad)).toMatch(/could not be read/);
    }
    expect(problemOf(s.settingsChangeFrom({}))).toBe("Nothing to change.");
    expect(problemOf(s.settingsChangeFrom({ summaryRecipients: Array.from({ length: 51 }, (_, i) => `u${i}`) }))).toBe("The summary goes to at most 50 people.");
    expect(problemOf(s.settingsChangeFrom({ summaryRecipients: Array.from({ length: 50 }, (_, i) => `u${i}`) }))).toBeNull();
  });

  test("who changes which: names, view-as and recipients are the Owner's; rent volume and separate emails also a Manager's", () => {
    const allowed = (role: StaffRole) => s.SETTING_KEYS.filter((k) => s.settingsChangeProblem(role, { [k]: k === "summaryRecipients" ? null : true }) === null);
    expect(allowed("owner")).toEqual(s.SETTING_KEYS);
    expect(allowed("manager")).toEqual(["showRentVolume", "staffEmailSeparate"]);
    for (const r of ["supervisor", "support", "viewer"] as const) expect(allowed(r)).toEqual([]);
    expect(s.settingsChangeProblem("manager", { viewAsEnabled: true })).toBe("Only an Owner can change that setting.");
    expect(s.settingsChangeProblem("viewer", { showRentVolume: false })).toBe("Only an Owner or Manager can change that setting.");
    expect(s.settingsChangeProblem("manager", { showRentVolume: false, managersSeeNames: true })).toBe("Only an Owner can change that setting.");
  });
});

describe("what each role may do (§4)", () => {
  const caps: s.Capability[] = ["stats", "names", "rentVolume", "subscriptions", "billing", "notes", "invites", "orgRecords", "viewAs", "staff"];
  const table = (settings: s.ConsoleSettings) =>
    Object.fromEntries(s.STAFF_ROLES.map((r) => [r, caps.filter((c) => s.can(r, c, settings))]));

  test("with the default settings", () => {
    expect(table(D)).toEqual({
      owner: ["stats", "names", "rentVolume", "subscriptions", "billing", "notes", "invites", "orgRecords", "staff"],
      manager: ["stats", "rentVolume", "subscriptions", "billing", "notes", "invites", "staff"],
      supervisor: ["stats", "names", "rentVolume", "subscriptions", "billing", "notes", "invites"],
      support: ["stats", "names", "subscriptions", "notes", "invites"],
      viewer: ["stats", "rentVolume"],
    });
  });

  test("the Owner's switches: Managers see names (S1), view-as for the Owner and Support (S3); rent volume off hides it from all (S2)", () => {
    const t = table({ ...D, managersSeeNames: true, viewAsEnabled: true, showRentVolume: false });
    expect(t["manager"]).toContain("names");
    expect(s.STAFF_ROLES.filter((r) => s.can(r, "viewAs", { ...D, viewAsEnabled: true }))).toEqual(["owner", "support"]);
    expect(s.STAFF_ROLES.filter((r) => t[r]?.includes("rentVolume"))).toEqual([]);
    expect(s.STAFF_ROLES.filter((r) => s.can(r, "names", { ...D, managersSeeNames: true }))).toEqual(["owner", "manager", "supervisor", "support"]);
  });

  test("subscription actions: notes for all but the Viewer, everything else for billing roles", () => {
    expect(s.STAFF_ROLES.filter((r) => s.canTakeAction(r, "addNote", D))).toEqual(["owner", "manager", "supervisor", "support"]);
    expect(s.STAFF_ROLES.filter((r) => s.canTakeAction(r, "recordPayment", D))).toEqual(["owner", "manager", "supervisor"]);
  });

  test("audit log: Owners and Managers all of it, Supervisors their team's, Support their own, Viewers none", () => {
    expect(s.STAFF_ROLES.map(s.auditScope)).toEqual(["all", "all", "team", "own", "none"]);
    expect(s.TEAM_ROLES).toEqual(["supervisor", "support"]);
  });

  test("role names and the role check", () => {
    expect(s.STAFF_ROLES.map((r) => s.ROLE_NAMES[r])).toEqual(["Owner", "Manager", "Supervisor", "Support", "Viewer"]);
    expect(s.isStaffRole("manager")).toBe(true);
    expect(s.isStaffRole("operator")).toBe(false);
    expect(s.isStaffRole(undefined)).toBe(false);
  });
});

describe("reading a staff action (§9)", () => {
  test("an invitation: email lower-cased, name trimmed, a role", () => {
    expect(s.staffActionFrom({ kind: "invite", email: " Ann@Sasimem.Example ", role: "viewer", displayName: " Ann Kila " }))
      .toEqual({ kind: "invite", email: "ann@sasimem.example", role: "viewer", displayName: "Ann Kila" });
  });

  test("actions on someone name their uid; a role change also the role", () => {
    expect(s.staffActionFrom({ kind: "changeRole", uid: "u_1-x", role: "manager" })).toEqual({ kind: "changeRole", uid: "u_1-x", role: "manager" });
    for (const kind of ["suspend", "reactivate", "remove", "resetMfa", "resendInvite"]) expect(s.staffActionFrom({ kind, uid: "u1", extra: 1 })).toEqual({ kind, uid: "u1" });
    expect(s.staffActionFrom({ kind: "list" })).toEqual({ kind: "list" });
    expect(s.staffActionFrom({ kind: "signOutEverywhere", uid: "x" })).toEqual({ kind: "signOutEverywhere" });
  });

  test("anything else is refused in plain words", () => {
    const invite = { kind: "invite", email: "a@b.example", role: "viewer", displayName: "A" };
    expect(problemOf(s.staffActionFrom({ ...invite, email: "nope" }))).toBe("Enter their email address, like name@example.com.");
    expect(problemOf(s.staffActionFrom({ ...invite, email: 5 }))).toBe("Enter their email address, like name@example.com.");
    expect(problemOf(s.staffActionFrom({ ...invite, role: "operator" }))).toBe("Choose a role.");
    expect(problemOf(s.staffActionFrom({ ...invite, displayName: "  " }))).toBe("Enter their name.");
    expect(problemOf(s.staffActionFrom({ ...invite, displayName: 3 }))).toBe("Enter their name.");
    expect(problemOf(s.staffActionFrom({ ...invite, displayName: "x".repeat(81) }))).toBe("A name is at most 80 characters.");
    expect(problemOf(s.staffActionFrom({ ...invite, displayName: "x".repeat(80) }))).toBeNull();
    expect(problemOf(s.staffActionFrom({ kind: "changeRole", uid: "u1", role: "boss" }))).toBe("Choose a role.");
    for (const bad of [null, 7, { kind: "promote", uid: "u1" }, { kind: "suspend" }, { kind: "suspend", uid: "a/b" }, { kind: "remove", uid: "" }]) {
      expect(problemOf(s.staffActionFrom(bad)), JSON.stringify(bad)).toMatch(/could not be read/);
    }
  });
});

describe("who may manage whom (§4 guards)", () => {
  const owner = member("o1", "owner");
  const manager = member("m1", "manager");
  const invite = (role: StaffRole) => ({ kind: "invite", email: "x@y.example", role, displayName: "X" }) as const;

  test("only Owners and Managers manage staff; anyone may sign themselves out everywhere", () => {
    for (const r of ["supervisor", "support", "viewer"] as const) {
      expect(s.staffActionProblem(member("x", r), { kind: "list" }, null, 1)).toBe(s.NOT_STAFF_MANAGER);
      expect(s.staffActionProblem(member("x", r), invite("viewer"), null, 1)).toBe(s.NOT_STAFF_MANAGER);
      expect(s.staffActionProblem(member("x", r), { kind: "signOutEverywhere" }, null, 1)).toBeNull();
    }
    expect(s.staffActionProblem(manager, { kind: "list" }, null, 1)).toBeNull();
  });

  test("a Manager invites and manages Supervisors, Support and Viewers, never Owners or Managers", () => {
    expect(s.rolesAssignableBy("manager")).toEqual(["supervisor", "support", "viewer"]);
    expect(s.rolesAssignableBy("owner")).toEqual(s.STAFF_ROLES);
    expect(s.rolesAssignableBy("viewer")).toEqual([]);
    expect(s.staffActionProblem(manager, invite("support"), null, 1)).toBeNull();
    expect(s.staffActionProblem(manager, invite("manager"), null, 1)).toBe(s.ONLY_OWNER_FOR_SENIOR);
    expect(s.staffActionProblem(manager, { kind: "suspend", uid: "m2" }, member("m2", "manager"), 1)).toBe(s.ONLY_OWNER_FOR_SENIOR);
    expect(s.staffActionProblem(manager, { kind: "changeRole", uid: "v1", role: "manager" }, member("v1", "viewer"), 1)).toBe(s.ONLY_OWNER_FOR_SENIOR);
    expect(s.staffActionProblem(manager, { kind: "changeRole", uid: "v1", role: "support" }, member("v1", "viewer"), 1)).toBeNull();
    expect(s.staffActionProblem(owner, invite("owner"), null, 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "changeRole", uid: "m2", role: "viewer" }, member("m2", "manager"), 1)).toBeNull();
  });

  test("nobody changes their own access", () => {
    for (const a of [{ kind: "changeRole", uid: "o1", role: "viewer" }, { kind: "suspend", uid: "o1" }, { kind: "remove", uid: "o1" }, { kind: "resetMfa", uid: "o1" }] as const) {
      expect(s.staffActionProblem(owner, a, owner, 2)).toBe(s.NOT_YOURSELF);
    }
  });

  test("there is always an active Owner", () => {
    const other = member("o2", "owner");
    expect(s.staffActionProblem(owner, { kind: "remove", uid: "o2" }, other, 1)).toBe(s.LAST_OWNER);
    expect(s.staffActionProblem(owner, { kind: "suspend", uid: "o2" }, other, 1)).toBe(s.LAST_OWNER);
    expect(s.staffActionProblem(owner, { kind: "changeRole", uid: "o2", role: "manager" }, other, 1)).toBe(s.LAST_OWNER);
    expect(s.staffActionProblem(owner, { kind: "remove", uid: "o2" }, other, 2)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "remove", uid: "o2" }, member("o2", "owner", "suspended"), 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "resetMfa", uid: "o2" }, other, 1)).toBeNull();
  });

  test("each action fits the target's standing", () => {
    const v = member("v1", "viewer");
    const off = member("v1", "viewer", "suspended");
    expect(s.staffActionProblem(owner, invite("viewer"), v, 1)).toBe("That person is already staff. Change their role instead.");
    expect(s.staffActionProblem(owner, invite("viewer"), off, 1)).toBe("That person is already staff. Change their role instead.");
    expect(s.staffActionProblem(owner, invite("viewer"), member("v1", "viewer", "removed"), 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "suspend", uid: "v1" }, null, 1)).toBe("That person is not staff.");
    expect(s.staffActionProblem(owner, { kind: "suspend", uid: "v1" }, member("v1", "viewer", "removed"), 1)).toBe("That person is not staff.");
    expect(s.staffActionProblem(owner, { kind: "changeRole", uid: "v1", role: "viewer" }, v, 1)).toBe("They are already Viewer.");
    expect(s.staffActionProblem(owner, { kind: "suspend", uid: "v1" }, off, 1)).toBe("They are already suspended.");
    expect(s.staffActionProblem(owner, { kind: "suspend", uid: "v1" }, v, 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "reactivate", uid: "v1" }, v, 1)).toBe("They are not suspended.");
    expect(s.staffActionProblem(owner, { kind: "reactivate", uid: "v1" }, off, 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "remove", uid: "v1" }, off, 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "changeRole", uid: "v1", role: "support" }, off, 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "resendInvite", uid: "v1" }, v, 1)).toBeNull();
    expect(s.staffActionProblem(owner, { kind: "resendInvite", uid: "v1" }, off, 1)).toBe("Reactivate them first.");
    expect(s.staffActionProblem(manager, { kind: "resendInvite", uid: "o2" }, member("o2", "owner"), 2)).toBe(s.ONLY_OWNER_FOR_SENIOR);
  });

  test("the staff document after each action", () => {
    const v = member("v1", "viewer");
    expect(s.staffAfter({ kind: "invite", email: "a@b.example", role: "support", displayName: "A" }, null)).toEqual({ role: "support", status: "active" });
    expect(s.staffAfter({ kind: "changeRole", uid: "v1", role: "support" }, member("v1", "viewer", "suspended"))).toEqual({ role: "support", status: "suspended" });
    expect(s.staffAfter({ kind: "suspend", uid: "v1" }, v)).toEqual({ role: "viewer", status: "suspended" });
    expect(s.staffAfter({ kind: "reactivate", uid: "v1" }, member("v1", "viewer", "suspended"))).toEqual({ role: "viewer", status: "active" });
    expect(s.staffAfter({ kind: "remove", uid: "v1" }, v)).toEqual({ role: "viewer", status: "removed" });
    expect(s.staffAfter({ kind: "resetMfa", uid: "v1" }, v)).toBeNull();
    expect(s.staffAfter({ kind: "resendInvite", uid: "v1" }, v)).toBeNull();
    expect(s.staffAfter({ kind: "list" }, null)).toBeNull();
    expect(s.staffAfter({ kind: "suspend", uid: "v1" }, null)).toBeNull();
  });
});
