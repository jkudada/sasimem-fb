import type { CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { adminDb } from "./index.js";

/** A callable request as Firebase would deliver it, from a signed-in user (with these token claims) or nobody. */
export function request<T>(uid: string | null, data: T, claims: Record<string, unknown> = {}): CallableRequest<T> {
  return {
    data,
    rawRequest: {} as CallableRequest<T>["rawRequest"],
    acceptsStreaming: false,
    ...(uid === null ? {} : { auth: { uid, token: { uid, ...claims } as never, rawToken: "test" } }),
  };
}

/** The claims of staff signed in with their authenticator code (PLAN-SUBSCRIBERS D10; the role is in staff/{uid}). */
export const OPERATOR = { email: "joe@sasimem.example", firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } };

/**
 * A member of staff (PLAN-ADMIN-DASHBOARD §4): their staff/{uid} record, and the claims of
 * their session signed in with the code. The callables read the record, not the claims.
 */
export async function asStaff(uid: string, role: string, status = "active"): Promise<Record<string, unknown>> {
  const email = `${uid}@sasimem.example`;
  await adminDb().doc(`staff/${uid}`).set({ role, status, email, displayName: uid, lastSeenAt: null });
  return { ...OPERATOR, email, staffRole: role };
}

/** A fresh user in the Auth emulator, so custom claims can be set and read back; verified unless a test says not. */
export async function newUser(opts: { email?: string; verified?: boolean } = {}): Promise<string> {
  adminDb(); // make sure the default app exists
  const { uid } = await getAuth().createUser({ email: opts.email ?? `${crypto.randomUUID()}@test.example`, password: "secret-123", emailVerified: opts.verified ?? true });
  return uid;
}

export const typedOrg = {
  name: "Wari Holdings",
  address: "Section 12, Lot 4, Boroko",
  email: "mary@wari.example",
  gstRegistered: false,
  gstNumber: "",
  bankName: "BSP",
  bankAccount: "1000 2345 6789",
};
