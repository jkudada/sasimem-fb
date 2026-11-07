import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { SignIn } from "./SignIn.js";
import { ResetPassword } from "./ResetPassword.js";
import { SignUp } from "./SignUp.js";

const type = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

test("signing in sends the email and password, and shows a plain message when it fails", async () => {
  const onSignIn = vi.fn().mockResolvedValue("That email and password do not match.");
  render(<SignIn onSignIn={onSignIn} />);
  type(/email/i, "mary@wari.example");
  type(/password/i, "secret-123");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(onSignIn).toHaveBeenCalledWith("mary@wari.example", "secret-123");
  expect((await screen.findByRole("alert")).textContent).toBe("That email and password do not match.");
  expect(screen.getByRole("link", { name: /create an account/i }).getAttribute("href")).toBe("/sign-up");
  expect(screen.getByRole("link", { name: /forgot/i }).getAttribute("href")).toBe("/reset");
});

test("creating an account needs a password of at least 6 characters, checked before anything is sent", async () => {
  const onSignUp = vi.fn().mockResolvedValue(null);
  render(<SignUp onSignUp={onSignUp} />);
  type(/email/i, "mary@wari.example");
  type(/password/i, "12345");
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Use a password of at least 6 characters.");
  expect(onSignUp).not.toHaveBeenCalled();
  type(/password/i, "123456");
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(onSignUp).toHaveBeenCalledWith("mary@wari.example", "123456");
});

test("asking for a password reset always gives the same answer, so it never reveals who has an account", async () => {
  const onReset = vi.fn().mockRejectedValue(new Error("auth/user-not-found"));
  render(<ResetPassword onReset={onReset} />);
  type(/email/i, "nobody@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect((await screen.findByRole("status")).textContent).toBe("If there is an account for that email, a reset link is on its way. Check your inbox.");
  expect(onReset).toHaveBeenCalledWith("nobody@example.com");
});
