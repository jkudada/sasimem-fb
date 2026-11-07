import { expect, test } from "vitest";
import { screenFor } from "./route.js";

test("signed out sees sign-in; signed in without an organisation sees onboarding; with one, home", () => {
  expect(screenFor({ status: "loading" })).toBe("loading");
  expect(screenFor({ status: "signedOut" })).toBe("signIn");
  expect(screenFor({ status: "signedIn", email: "m@w.example", orgId: null })).toBe("onboarding");
  expect(screenFor({ status: "signedIn", email: "m@w.example", orgId: "org1" })).toBe("home");
});
