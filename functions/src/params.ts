/**
 * Deployment parameters (plan §6). APP_URL is the Hosting origin approval links point
 * at, and MAIL_FROM the sending address, both set per project in functions/.env.<project>.
 * APPROVAL_SIGNING_KEY signs the page's form nonces and RESEND_API_KEY sends mail:
 * Secret Manager secrets, never in git; the emulator reads functions/.secret.local
 * (gitignored) and never sends real mail.
 */
import { defineSecret, defineString } from "firebase-functions/params";

export const APP_URL = defineString("APP_URL", { description: "The Hosting origin approval links point at, e.g. https://sasimem-dev.web.app" });
export const MAIL_FROM = defineString("MAIL_FROM", { description: "The sending address on the sending domain, e.g. invoices@mail.sasimem.example" });
export const APPROVAL_SIGNING_KEY = defineSecret("APPROVAL_SIGNING_KEY");
export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
