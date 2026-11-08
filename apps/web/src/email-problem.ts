/**
 * A failed email in the log, in plain English (plan §7: no jargon). The log keeps the
 * provider's own error, e.g. "Resend refused the message (401): API key is invalid"
 * (functions/src/mail/resend.ts) or "Gmail refused the message (535): ..." (gmail.ts);
 * its status code says whose problem it is.
 */
const NOT_SET_UP = "Sasimem's email service is not set up properly, so nothing was sent. The address is fine. Use Email again once it is fixed.";
const TEST_SENDER = "Sasimem can only email your own address until its sending domain is set up. The address is fine.";
const BAD_ADDRESS = "That email address was rejected. Check it in the tenant's details, then use Email again.";
const DAILY_LIMIT = "Sasimem has sent as much email as Gmail allows today, so nothing was sent. The address is fine. Use Email again tomorrow.";
const LATER = "The email service was busy or could not be reached. Use Email again in a few minutes.";
const FALLBACK = "Use Email again. If it fails again, check the address.";

export function emailProblem(error: string | null): string {
  if (error === null) return FALLBACK;
  const refused = /^(Resend|Gmail) refused the message \((\d{3})\)/.exec(error);
  if (refused === null) return /invalid `to`/i.test(error) ? BAD_ADDRESS : LATER;
  const status = Number(refused[2]);
  return refused[1] === "Gmail" ? gmailProblem(status, error) : resendProblem(status, error);
}

/** Resend answers with HTTP statuses. */
function resendProblem(status: number, error: string): string {
  if (status === 403 && /testing emails|verify a domain/i.test(error)) return TEST_SENDER;
  if (status === 401 || status === 403) return NOT_SET_UP;
  if (status === 422) return BAD_ADDRESS;
  if (status === 429 || status >= 500) return LATER;
  return FALLBACK;
}

/** Gmail answers with SMTP reply codes: 53x is the login, 55x the recipient, 4xx try later. */
function gmailProblem(status: number, error: string): string {
  if (status >= 530 && status <= 539) return NOT_SET_UP;
  if (/sending limit|quota/i.test(error)) return DAILY_LIMIT;
  if (status === 550 || status === 553 || status === 501) return BAD_ADDRESS;
  if (status >= 400 && status < 500) return LATER;
  return FALLBACK;
}
