import { expect, test } from "vitest";
import { emailProblem } from "./email-problem.js";

// The email log keeps the provider's own error (functions/src/mail/resend.ts); the landlord reads a plain sentence.
test("a refused key or an unverified sender is not the address's fault, and says so", () => {
  expect(emailProblem("Resend refused the message (401): API key is invalid")).toBe(
    "Sasimem's email service is not set up properly, so nothing was sent. The address is fine. Use Email again once it is fixed.");
  expect(emailProblem("Resend refused the message (403): You can only send testing emails to your own email address (me@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.")).toBe(
    "Sasimem can only email your own address until its sending domain is set up. The address is fine.");
  expect(emailProblem("Resend refused the message (403): The gmail.com domain is not verified.")).toBe(
    "Sasimem's email service is not set up properly, so nothing was sent. The address is fine. Use Email again once it is fixed.");
});

test("a rejected address asks for the address to be fixed", () => {
  expect(emailProblem("Resend refused the message (422): Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.")).toBe(
    "That email address was rejected. Check it in the tenant's details, then use Email again.");
  expect(emailProblem("Invalid `to` field.")).toBe("That email address was rejected. Check it in the tenant's details, then use Email again.");
});

test("a busy or unreachable service asks to try again later", () => {
  const later = "The email service was busy or could not be reached. Use Email again in a few minutes.";
  expect(emailProblem("Resend refused the message (429): Too many requests")).toBe(later);
  expect(emailProblem("Resend refused the message (503): Service Unavailable")).toBe(later);
  expect(emailProblem("fetch failed")).toBe(later);
});

test("anything else, or no error at all, falls back to trying again", () => {
  const fallback = "Use Email again. If it fails again, check the address.";
  expect(emailProblem(null)).toBe(fallback);
  expect(emailProblem("Resend refused the message (400): Something new")).toBe(fallback);
});

// Gmail's SMTP replies (functions/src/mail/gmail.ts), used while testing.
test("Gmail: a refused app password is not the address's fault", () => {
  expect(emailProblem("Gmail refused the message (535): 535-5.7.8 Username and Password not accepted.")).toBe(
    "Sasimem's email service is not set up properly, so nothing was sent. The address is fine. Use Email again once it is fixed.");
  expect(emailProblem("Gmail refused the message (534): 534-5.7.9 Application-specific password required.")).toBe(
    "Sasimem's email service is not set up properly, so nothing was sent. The address is fine. Use Email again once it is fixed.");
});

test("Gmail: a refused recipient asks for the address to be fixed", () => {
  expect(emailProblem("Gmail refused the message (553): 553-5.1.3 The recipient address <x@> is not a valid RFC 5321 address.")).toBe(
    "That email address was rejected. Check it in the tenant's details, then use Email again.");
});

test("Gmail: the daily sending limit asks to wait until tomorrow", () => {
  expect(emailProblem("Gmail refused the message (550): 550-5.4.5 Daily user sending limit exceeded.")).toBe(
    "Sasimem has sent as much email as Gmail allows today, so nothing was sent. The address is fine. Use Email again tomorrow.");
});

test("Gmail: a busy or unreachable server asks to try again later", () => {
  const later = "The email service was busy or could not be reached. Use Email again in a few minutes.";
  expect(emailProblem("Gmail refused the message (421): 421-4.7.0 Try again later, closing connection.")).toBe(later);
  expect(emailProblem("Gmail could not be reached (ETIMEDOUT): Connection timeout")).toBe(later);
});
