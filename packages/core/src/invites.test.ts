import { describe, expect, test } from "vitest";
import * as i from "./invites.js";

const refused = (x: unknown) => {
  const r = i.inviteRequestFrom(x);
  return "problem" in r ? r.problem : null;
};

describe("an operator's invitation request (PLAN-SUBSCRIBERS S3)", () => {
  test("sending names an email, a plan, a trial length and how long it lasts; the email is kept lower-case", () => {
    expect(i.inviteRequestFrom({ kind: "send", email: " Mary@Wari.Example ", planId: "plus", trialDays: 30, expiresInDays: 14 }))
      .toEqual({ kind: "send", email: "mary@wari.example", planId: "plus", trialDays: 30, expiresInDays: 14 });
  });

  test("a free invitation has no trial, whatever was typed", () => {
    expect(i.inviteRequestFrom({ kind: "send", email: "a@b.example", planId: "free", trialDays: 60, expiresInDays: 30 })).toMatchObject({ trialDays: 0 });
  });

  test("revoking names only the email", () => {
    expect(i.inviteRequestFrom({ kind: "revoke", email: "A@b.example" })).toEqual({ kind: "revoke", email: "a@b.example" });
  });

  test("anything else is refused in plain words", () => {
    const send = { kind: "send", email: "a@b.example", planId: "standard", trialDays: 60, expiresInDays: 30 };
    expect(refused({ ...send, email: "not an email" })).toBe("Enter the email address to invite, like name@example.com.");
    expect(refused({ ...send, planId: "gold" })).toBe("Choose Free, Standard or Plus.");
    expect(refused({ ...send, trialDays: 0 })).toBe("A trial is 1 to 365 days.");
    expect(refused({ ...send, expiresInDays: 91 })).toBe("An invitation lasts 1 to 90 days.");
    expect(refused({ kind: "forget" })).toMatch(/could not be read/);
  });
});

describe("what an invitation gives the sign-up", () => {
  test("its plan and trial length", () => {
    expect(i.inviteTermsFrom({ planId: "plus", trialDays: 30 })).toEqual({ planId: "plus", trialDays: 30 });
    expect(i.inviteTermsFrom({ planId: "free", trialDays: 0 })).toEqual({ planId: "free", trialDays: 0 });
  });

  test("an invitation from before plans (ops/invite.ts) gives the standard 60-day trial", () => {
    expect(i.inviteTermsFrom({ invitedAt: new Date() })).toEqual({ planId: "standard", trialDays: 60 });
    expect(i.inviteTermsFrom({ planId: "gold", trialDays: -1 })).toEqual({ planId: "standard", trialDays: 60 });
  });
});
