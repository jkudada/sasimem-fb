/**
 * Deployment parameters (plan §6). APP_URL is the Hosting origin approval links point
 * at, and MAIL_FROM the sending address, both set per project in functions/.env.<project>.
 * APPROVAL_SIGNING_KEY signs the page's form nonces and RESEND_API_KEY or
 * GMAIL_APP_PASSWORD sends mail: Secret Manager secrets, never in git; the emulator
 * reads functions/.secret.local (gitignored) and never sends real mail.
 *
 * MAIL_PROVIDER picks the sender at run time: "gmail" while testing (MAIL_FROM is then
 * the Gmail address), anything else Resend. Each function that sends mail declares both
 * secrets, so both must exist in every project (a placeholder value is fine for the one
 * not used): the deploy reads the declared secrets while loading the code, without
 * functions/.env.<project>, so it cannot choose between them by MAIL_PROVIDER.
 */
import { defineSecret, defineString } from "firebase-functions/params";

export const APP_URL = defineString("APP_URL", { description: "The Hosting origin approval links point at, e.g. https://sasimem-dev.web.app" });
export const MAIL_FROM = defineString("MAIL_FROM", { description: "The sending address on the sending domain, e.g. invoices@mail.sasimem.example" });
export const APPROVAL_SIGNING_KEY = defineSecret("APPROVAL_SIGNING_KEY");
export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
export const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");

/** Read at run time, from functions/.env.<project>. */
export const usesGmail = (): boolean => process.env["MAIL_PROVIDER"] === "gmail";
/** The secrets every function that sends mail declares: both senders', see above. */
export const MAIL_SECRETS = [GMAIL_APP_PASSWORD, RESEND_API_KEY];

/**
 * Who may create an organisation (docs/PLAN-TEMPLATES.md §7): "invite" (the default)
 * admits only emails in signupInvites, added by ops/invite.ts; "open" admits any
 * verified email. Anything else is read as "invite", so a typo fails closed.
 */
export const SIGNUP_MODE = defineString("SIGNUP_MODE", { default: "invite", description: "invite (only invited emails may create an organisation) or open" });
export type SignupMode = "invite" | "open";
export const signupModeOf = (value: string): SignupMode => (value === "open" ? "open" : "invite");
