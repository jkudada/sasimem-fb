/** Every callable re-checks membership (plan §6.2): signed in, and an owner of the org it names. */
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { isOwner } from "../store/numbering.js";

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
