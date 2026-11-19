/**
 * Sign-in with a password and a TOTP code, and setting a code up (PLAN-SUBSCRIBERS D10).
 * The only code that talks to Firebase Auth; screens get the plain functions in Actions.
 */
import { signal } from "@preact/signals";
import {
  getMultiFactorResolver, multiFactor, type MultiFactorError, type MultiFactorResolver, onIdTokenChanged,
  signInWithEmailAndPassword, signOut, TotpMultiFactorGenerator, type TotpSecret,
} from "firebase/auth";
import type { Actions, SignInResult } from "./app.js";
import { auth } from "./firebase.js";
import { type ConsoleSession, sessionEnd, sessionFrom } from "./session.js";

export const session = signal<ConsoleSession>({ status: "loading" });

/** Why the last session ended on its own, shown once on the sign-in screen. */
let notice: string | null = null;
/** When this session was signed in (the token's auth_time), for the 12-hour limit. */
let signedInAt = Date.now();
let lastActivity = Date.now();

onIdTokenChanged(auth, async (user) => {
  if (user === null) {
    session.value = notice === null ? sessionFrom(null) : { status: "signedOut", notice };
    notice = null;
    return;
  }
  const token = await user.getIdTokenResult();
  signedInAt = Date.parse(token.authTime) || Date.now();
  lastActivity = Date.now();
  session.value = sessionFrom({
    uid: user.uid,
    email: user.email ?? "",
    staffRole: token.claims["staffRole"],
    secondFactor: token.signInSecondFactor,
    enrolledFactors: multiFactor(user).enrolledFactors.length,
  });
});

// Sign out after 30 idle minutes, or 12 hours signed in (PLAN-ADMIN-DASHBOARD §8).
for (const kind of ["pointerdown", "keydown"]) addEventListener(kind, () => { lastActivity = Date.now(); }, { passive: true });
setInterval(() => {
  if (auth.currentUser === null) return;
  const why = sessionEnd({ lastActivity, signedInAt, now: Date.now() });
  if (why !== null) {
    notice = why;
    void signOut(auth);
  }
}, 30_000);

const codeOf = (e: unknown): string => (typeof e === "object" && e !== null && "code" in e ? String(e.code) : "");

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password do not match.",
  "auth/wrong-password": "That email and password do not match.",
  "auth/user-not-found": "That email and password do not match.",
  "auth/invalid-verification-code": "That code is not right. Codes change every 30 seconds: use the one showing now.",
  "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
  "auth/network-request-failed": "No connection. Check it and try again.",
  "auth/requires-recent-login": "For safety, sign out and in again, then set up the code straight away.",
  "auth/operation-not-allowed": "Two-step codes are not turned on for this project yet (Identity Platform, TOTP). See docs/runbooks/subscribers.md.",
  "auth/unsupported-first-factor": "Two-step codes are not turned on for this project yet (Identity Platform, TOTP). See docs/runbooks/subscribers.md.",
};
const message = (e: unknown): string => MESSAGES[codeOf(e)] ?? "Something went wrong. Please try again.";

let resolver: MultiFactorResolver | null = null;
let secret: TotpSecret | null = null;

export const actions: Actions = {
  operate: (orgId, action) => import("./callables.js").then((c) => c.operate(orgId, action)),
  invite: (request) => import("./callables.js").then((c) => c.invite(request)),
  staff: (action) => import("./callables.js").then((c) => c.manageStaff(action)),
  updateSettings: (change) => import("./callables.js").then((c) => c.updateSettings(change)),
  async signIn(email, password): Promise<SignInResult> {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return { kind: "in" };
    } catch (e) {
      if (codeOf(e) !== "auth/multi-factor-auth-required") return { kind: "problem", message: message(e) };
      resolver = getMultiFactorResolver(auth, e as MultiFactorError);
      const totp = resolver.hints.some((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      return totp ? { kind: "code" } : { kind: "problem", message: "This account's second step is not an authenticator app code." };
    }
  },
  async verifyCode(code) {
    const hint = resolver?.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (resolver === null || hint === undefined) return "Start again: enter your email and password.";
    try {
      await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
      resolver = null;
      return null;
    } catch (e) {
      return message(e);
    }
  },
  async startEnrolment() {
    const user = auth.currentUser;
    if (user === null) return { problem: "Sign in first." };
    try {
      secret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession());
      return { key: secret.secretKey, url: secret.generateQrCodeUrl(user.email ?? "staff", "Sasimem console") };
    } catch (e) {
      return { problem: message(e) };
    }
  },
  async finishEnrolment(code) {
    const user = auth.currentUser;
    if (user === null || secret === null) return "Start again: set up the code from the beginning.";
    try {
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code), "Authenticator app");
      secret = null;
      // This session was signed in with a password alone; the rules want one signed in with the code.
      await signOut(auth);
      return null;
    } catch (e) {
      return message(e);
    }
  },
  async signOut() {
    await signOut(auth);
  },
  async data() {
    return (await import("./data.js")).consoleData;
  },
};
