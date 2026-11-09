import { expect, test } from "vitest";
import { screenFor } from "./route.js";

test("signed out sees sign-in; signed in without an organisation sees onboarding; with one, home", () => {
  expect(screenFor({ status: "loading" })).toBe("loading");
  expect(screenFor({ status: "signedOut" })).toBe("signIn");
  expect(screenFor({ status: "signedIn", email: "m@w.example", emailVerified: true, orgId: null })).toBe("onboarding");
  expect(screenFor({ status: "signedIn", email: "m@w.example", emailVerified: true, orgId: "org1" })).toBe("home");
});

test("signed in without an organisation and an unconfirmed email: confirm it first (docs/PLAN-TEMPLATES.md §7)", () => {
  expect(screenFor({ status: "signedIn", email: "m@w.example", emailVerified: false, orgId: null })).toBe("verify");
  expect(screenFor({ status: "signedIn", email: "m@w.example", emailVerified: false, orgId: "org1" })).toBe("home");
});
