/**
 * App Check for the console (plan §5): Firestore refuses reads without a token once
 * enforcement is on. Same reCAPTCHA Enterprise key as the landlord app; its allowed
 * domains must include the console's site (`node ops/app-check.ts --domain ...`).
 */
import type { FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

export function startAppCheck(app: FirebaseApp, siteKey: string | undefined): void {
  const key = siteKey?.trim() ?? "";
  if (key === "") throw new Error("VITE_RECAPTCHA_SITE_KEY is not set: Firestore would refuse the console.");
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true });
}
