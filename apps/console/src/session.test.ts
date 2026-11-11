import { describe, expect, test } from "vitest";
import { sessionFrom } from "./session.js";

const user = (o: Partial<Parameters<typeof sessionFrom>[0] & object> = {}) =>
  ({ email: "op@sasimem.example", operator: true, secondFactor: "totp", enrolledFactors: 1, ...o });

describe("who gets into the console (PLAN-SUBSCRIBERS D10)", () => {
  test("nobody signed in sees sign-in", () => {
    expect(sessionFrom(null)).toEqual({ status: "signedOut" });
  });

  test("an operator signed in with their code is in", () => {
    expect(sessionFrom(user())).toEqual({ status: "ready", email: "op@sasimem.example" });
  });

  test("an operator with no code set up is sent to set one up, and sees no data", () => {
    expect(sessionFrom(user({ secondFactor: null, enrolledFactors: 0 }))).toEqual({ status: "needsEnrolment", email: "op@sasimem.example" });
  });

  test("an operator with a code set up but signed in without it signs in again", () => {
    expect(sessionFrom(user({ secondFactor: null }))).toEqual({ status: "needsSecondFactor", email: "op@sasimem.example" });
  });

  test("anyone without the operator claim is told so, code or not", () => {
    expect(sessionFrom(user({ operator: false }))).toEqual({ status: "notOperator", email: "op@sasimem.example" });
    expect(sessionFrom(user({ operator: false, secondFactor: null, enrolledFactors: 0 }))).toEqual({ status: "notOperator", email: "op@sasimem.example" });
  });
});
