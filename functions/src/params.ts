/**
 * Deployment parameters (plan §6). APP_URL is the Hosting origin approval links point
 * at, set per project in functions/.env.<project>. APPROVAL_SIGNING_KEY signs the
 * page's form nonces: a Secret Manager secret, never in git; the emulator reads
 * functions/.secret.local (gitignored).
 */
import { defineSecret, defineString } from "firebase-functions/params";

export const APP_URL = defineString("APP_URL", { description: "The Hosting origin approval links point at, e.g. https://sasimem-dev.web.app" });
export const APPROVAL_SIGNING_KEY = defineSecret("APPROVAL_SIGNING_KEY");
