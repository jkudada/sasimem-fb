import { describe, expect, test } from "vitest";
import { projectFrom } from "../src/guard.ts";
import { inviteEmail, inviteRequest } from "../src/invite.ts";

describe("ops/invite.ts (docs/PLAN-TEMPLATES.md §7)", () => {
  test("refuses to run without --project, and on an emulator project", () => {
    expect(() => projectFrom(["mary@wari.example"])).toThrow("Name the project: --project <id>. There is no default.");
    expect(() => projectFrom(["--project", "demo-sasimem", "mary@wari.example"])).toThrow(/emulator project/);
  });

  test("adds an invitation under the email in lower case, which createOrg looks up, and never overwrites one", () => {
    const email = inviteEmail("  Mary@Wari.Example ");
    expect(email).toBe("mary@wari.example");
    expect(inviteRequest("sasimem-dev", email, new Date("2026-11-08T00:00:00Z"))).toEqual({
      method: "POST",
      url: "https://firestore.googleapis.com/v1/projects/sasimem-dev/databases/(default)/documents/signupInvites?documentId=mary%40wari.example",
      body: { fields: { invitedAt: { timestampValue: "2026-11-08T00:00:00.000Z" } } },
    });
  });

  test("refuses something that is not an email", () => {
    expect(() => inviteEmail(undefined)).toThrow(/Name the email to invite/);
    expect(() => inviteEmail("mary")).toThrow(/not "mary"/);
  });
});
