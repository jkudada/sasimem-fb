/** Every callable re-checks membership (plan §6.2): signed in, and an owner of the org it names. */
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { isOwner } from "../store/numbering.js";
import { staffMember, type StaffActor } from "../store/staff.js";

export async function ownerOrg(request: CallableRequest<unknown>): Promise<string> {
  const uid = request.auth?.uid;
  if (uid === undefined) throw new HttpsError("unauthenticated", "Sign in first.");
  const data = request.data as { orgId?: unknown } | null;
  const orgId = data?.orgId;
  if (typeof orgId !== "string" || orgId === "" || !(await isOwner(orgId, uid))) {
    throw new HttpsError("permission-denied", "Only the organisation's owner can do this.");
  }
  return orgId;
}

export const uidOf = (request: CallableRequest<unknown>): string => request.auth?.uid ?? "";

/**
 * Staff (docs/PLAN-ADMIN-DASHBOARD.md §4): an active staff/{uid} document and a session
 * signed in with a second factor, as the rules' isStaff(). The document, not a claim,
 * decides, so a suspension holds from the next call.
 */
export const NOT_STAFF = "Only Sasimem staff, signed in with their code, can do this.";

/** The member of staff making this call (any role), or a refusal. Each callable then checks the role. */
export async function staffOf(request: CallableRequest<unknown>): Promise<StaffActor> {
  const auth = request.auth;
  if (auth === undefined) throw new HttpsError("unauthenticated", "Sign in first.");
  const token = auth.token as { email?: unknown; firebase?: { sign_in_second_factor?: unknown } };
  if (token.firebase?.sign_in_second_factor == null) throw new HttpsError("permission-denied", NOT_STAFF);
  const member = await staffMember(auth.uid);
  if (member === null || member.status !== "active") throw new HttpsError("permission-denied", NOT_STAFF);
  return { uid: auth.uid, email: typeof token.email === "string" ? token.email : "", role: member.role };
}

/** Refuse unless the caller's role may: `problem` in plain words. */
export function allow(allowed: boolean, problem: string): void {
  if (!allowed) throw new HttpsError("permission-denied", problem);
}
