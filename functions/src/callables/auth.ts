/** Every callable re-checks membership (plan §6.2): signed in, and an owner of the org it names. */
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { isOwner } from "../store/numbering.js";
import type { Actor } from "../store/subscriptions.js";

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

/** Operators (PLAN-SUBSCRIBERS D10): the claim and a second factor, as the rules' isOperator(). */
export const NOT_OPERATOR = "Only a Sasimem operator, signed in with their code, can do this.";

/** The operator making this call, or a refusal. */
export function operatorOf(request: CallableRequest<unknown>): Actor {
  const auth = request.auth;
  if (auth === undefined) throw new HttpsError("unauthenticated", "Sign in first.");
  const token = auth.token as { operator?: unknown; email?: unknown; firebase?: { sign_in_second_factor?: unknown } };
  if (token.operator !== true || token.firebase?.sign_in_second_factor == null) throw new HttpsError("permission-denied", NOT_OPERATOR);
  return { uid: auth.uid, email: typeof token.email === "string" ? token.email : "" };
}
