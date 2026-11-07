import { expect, test } from "vitest";
import { authMessage } from "./auth-messages.js";

test("Firebase's sign-in error codes become plain sentences, never codes", () => {
  expect(authMessage("auth/invalid-credential")).toBe("That email and password do not match.");
  expect(authMessage("auth/email-already-in-use")).toBe("There is already an account for that email. Sign in instead.");
  expect(authMessage("auth/weak-password")).toBe("Use a password of at least 6 characters.");
  expect(authMessage("auth/network-request-failed")).toBe("No connection. Check your signal and try again.");
  expect(authMessage("auth/too-many-requests")).toBe("Too many tries. Wait a few minutes and try again.");
  expect(authMessage("auth/something-new")).toBe("Something went wrong. Please try again.");
});
