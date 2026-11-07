/**
 * The session signal and the actions screens call. Firebase stays here and in
 * data.ts; screens receive plain functions that resolve to a message or null.
 */
import { signal } from "@preact/signals";
import type { OrgSetupInput } from "@sasimem/core";
import { createUserWithEmailAndPassword, onIdTokenChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import type { Actions } from "./app.js";
import { authMessage } from "./auth-messages.js";
import { auth } from "./firebase.js";
import type { Session } from "./route.js";
import type { FirstTenancy } from "./screens/TenancyStep.js";

export const session = signal<Session>({ status: "loading" });

// The org comes from the orgIds custom claim that createOrg sets (users/{uid} is not client-readable).
onIdTokenChanged(auth, async (user) => {
  if (user === null) {
    session.value = { status: "signedOut" };
    return;
  }
  const claims = (await user.getIdTokenResult()).claims;
  const orgIds = Array.isArray(claims["orgIds"]) ? (claims["orgIds"] as string[]) : [];
  session.value = { status: "signedIn", email: user.email ?? "", orgId: orgIds[0] ?? null };
});

const codeOf = (e: unknown): string => (typeof e === "object" && e !== null && "code" in e ? String(e.code) : "");
const OFFLINE = "You need a connection to do this. Check your signal and try again.";

/** A callable's own message is already plain English; a dropped connection gets ours. */
function callableMessage(e: unknown): string {
  const code = codeOf(e);
  if (code === "functions/unavailable" || code === "functions/deadline-exceeded" || !navigator.onLine) return OFFLINE;
  return e instanceof Error && code.startsWith("functions/") ? e.message : "Something went wrong. Please try again.";
}

export const actions: Actions = {
  async signIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password).then(() => null, (e: unknown) => authMessage(codeOf(e)));
  },
  async signUp(email, password) {
    return createUserWithEmailAndPassword(auth, email, password).then(() => null, (e: unknown) => authMessage(codeOf(e)));
  },
  async reset(email) {
    await sendPasswordResetEmail(auth, email);
  },
  async signOut() {
    await signOut(auth);
  },
  async createOrg(input: OrgSetupInput) {
    try {
      const data = await import("./data.js");
      await data.createOrg(input);
      await auth.currentUser?.getIdToken(true); // pick up the new orgIds claim
      return null;
    } catch (e) {
      return callableMessage(e);
    }
  },
  async saveFirstTenancy(first: FirstTenancy) {
    const s = session.value;
    if (s.status !== "signedIn" || s.orgId === null) return "Sign in first.";
    try {
      await (await import("./data.js")).saveFirstTenancy(s.orgId, first);
      return null;
    } catch {
      return navigator.onLine ? "That could not be saved. Please try again." : OFFLINE;
    }
  },
};
