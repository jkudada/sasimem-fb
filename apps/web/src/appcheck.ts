/**
 * App Check (plan §5): every callable refuses a request without a token, and Firestore
 * and Storage do too once enforcement is on for the project (ops/app-check.ts). Started
 * by the data layer, which loads after sign-in, so the sign-in route carries none of it.
 *
 * Against the emulators there is no reCAPTCHA: the app sends a placeholder token, which
 * the Functions emulator decodes but never verifies. It still refuses a call with no
 * token at all, so the T4 journeys prove every call carries one.
 */
import { type FirebaseApp } from "firebase/app";
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

export type AppCheckSetup = { kind: "placeholder" } | { kind: "recaptcha"; siteKey: string };

export function appCheckSetup(env: { usingEmulators: boolean; siteKey: string | undefined }): AppCheckSetup {
  if (env.usingEmulators) return { kind: "placeholder" };
  const siteKey = env.siteKey?.trim() ?? "";
  if (siteKey === "") throw new Error("VITE_RECAPTCHA_SITE_KEY is not set: every callable would refuse this app.");
  return { kind: "recaptcha", siteKey };
}

const HOUR = 3_600_000;
const base64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** An unsigned JWT naming the app, as the emulator expects; it is worthless anywhere else. */
export function placeholderToken(appId: string, now: number): { token: string; expireTimeMillis: number } {
  const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: appId, iat: now / 1000, exp: (now + HOUR) / 1000 }));
  return { token: `${header}.${payload}.placeholder`, expireTimeMillis: now + HOUR };
}

export function startAppCheck(app: FirebaseApp, env: { usingEmulators: boolean; siteKey: string | undefined }): void {
  const setup = appCheckSetup(env);
  const provider = setup.kind === "recaptcha"
    ? new ReCaptchaEnterpriseProvider(setup.siteKey)
    : new CustomProvider({ getToken: async () => placeholderToken(app.options.appId ?? "demo-sasimem-web", Date.now()) });
  initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
}
