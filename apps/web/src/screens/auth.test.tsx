import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { SignIn } from "./SignIn.js";

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
