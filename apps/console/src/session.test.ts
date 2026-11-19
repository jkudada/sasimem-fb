import { describe, expect, test } from "vitest";
import { IDLE_NOTICE, LONG_NOTICE, sessionEnd, sessionFrom } from "./session.js";

const user = (o: Partial<Parameters<typeof sessionFrom>[0] & object> = {}) =>
  ({ uid: "u1", email: "op@sasimem.example", staffRole: "owner", secondFactor: "totp", enrolledFactors: 1, ...o });

describe("who gets into the console (PLAN-SUBSCRIBERS D10, PLAN-ADMIN-DASHBOARD §4)", () => {
  test("nobody signed in sees sign-in", () => {
    expect(sessionFrom(null)).toEqual({ status: "signedOut" });
  });

  test("staff signed in with their code are in, in their role", () => {
    expect(sessionFrom(user())).toEqual({ status: "ready", email: "op@sasimem.example", uid: "u1", role: "owner" });
    expect(sessionFrom(user({ staffRole: "viewer" }))).toMatchObject({ status: "ready", role: "viewer" });
  });

  test("staff with no code set up are sent to set one up, and see no data", () => {
    expect(sessionFrom(user({ secondFactor: null, enrolledFactors: 0 }))).toEqual({ status: "needsEnrolment", email: "op@sasimem.example" });
  });

  test("staff with a code set up but signed in without it sign in again", () => {
    expect(sessionFrom(user({ secondFactor: null }))).toEqual({ status: "needsSecondFactor", email: "op@sasimem.example" });
  });

  test("anyone without a staff role is told so, code or not; the old operator claim is not a role", () => {
    for (const staffRole of [undefined, "operator", true, "Owner"]) {
      expect(sessionFrom(user({ staffRole }))).toEqual({ status: "notOperator", email: "op@sasimem.example" });
    }
    expect(sessionFrom(user({ staffRole: undefined, secondFactor: null, enrolledFactors: 0 }))).toEqual({ status: "notOperator", email: "op@sasimem.example" });
  });
});

describe("signing out on its own (§8)", () => {
  const MIN = 60_000;
  const t0 = Date.parse("2027-03-01T00:00:00Z");
  test("after 30 minutes without a click or a key", () => {
    expect(sessionEnd({ signedInAt: t0, lastActivity: t0, now: t0 + 29 * MIN })).toBeNull();
    expect(sessionEnd({ signedInAt: t0, lastActivity: t0, now: t0 + 30 * MIN })).toBe(IDLE_NOTICE);
    expect(IDLE_NOTICE).toBe("You were signed out after 30 minutes without activity.");
  });

  test("after 12 hours signed in, however busy", () => {
    const now = t0 + 12 * 60 * MIN;
    expect(sessionEnd({ signedInAt: t0, lastActivity: now - MIN, now: now - 1 })).toBeNull();
    expect(sessionEnd({ signedInAt: t0, lastActivity: now - MIN, now })).toBe(LONG_NOTICE);
  });
});
