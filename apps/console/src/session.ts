/** Who gets into the console: pure, so every case is a T1 test (the Auth emulator has no TOTP). */
import { isStaffRole, type StaffRole } from "@sasimem/core";

export type ConsoleSession =
  | { readonly status: "loading" }
  | { readonly status: "signedOut"; readonly notice?: string }
  | { readonly status: "notOperator"; readonly email: string }
  | { readonly status: "needsEnrolment"; readonly email: string }
  | { readonly status: "needsSecondFactor"; readonly email: string }
  | { readonly status: "ready"; readonly email: string; readonly uid: string; readonly role: StaffRole };

export interface SignedInUser {
  readonly uid: string;
  readonly email: string;
  /**
   * The `staffRole` custom claim (PLAN-ADMIN-DASHBOARD §4), set by the manageStaff callable
   * or ops/grant-staff.ts. It chooses the pages; the rules and callables read the staff
   * record itself, so a stale claim shows pages whose reads are refused, nothing more.
   */
  readonly staffRole: unknown;
  /** The token's firebase.sign_in_second_factor: null when signed in with a password alone. */
  readonly secondFactor: string | null;
  readonly enrolledFactors: number;
}

export function sessionFrom(user: SignedInUser | null): ConsoleSession {
  if (user === null) return { status: "signedOut" };
  const { email } = user;
  if (!isStaffRole(user.staffRole)) return { status: "notOperator", email };
  if (user.secondFactor !== null) return { status: "ready", email, uid: user.uid, role: user.staffRole };
  return user.enrolledFactors === 0 ? { status: "needsEnrolment", email } : { status: "needsSecondFactor", email };
}

/** Signed out after this long without a click or a key (PLAN-ADMIN-DASHBOARD §8). */
export const IDLE_MINUTES = 30;
/** And after this long signed in, however busy. */
export const MAX_SESSION_HOURS = 12;

export const IDLE_NOTICE = `You were signed out after ${IDLE_MINUTES} minutes without activity.`;
export const LONG_NOTICE = `You were signed out after ${MAX_SESSION_HOURS} hours. Sign in again to carry on.`;

/** Why the session should end now, or null. `signedInAt` is the token's auth_time. */
export function sessionEnd(o: { lastActivity: number; signedInAt: number; now: number }): string | null {
  if (o.now - o.signedInAt >= MAX_SESSION_HOURS * 3_600_000) return LONG_NOTICE;
  if (o.now - o.lastActivity >= IDLE_MINUTES * 60_000) return IDLE_NOTICE;
  return null;
}
