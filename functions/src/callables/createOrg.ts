/**
 * createOrg (plan §6.2): the org, the owner membership, the counter and the
 * custom claim. The browser cannot create an org itself (I9).
 */
import { type OrgSetupInput, withOrgDefaults } from "@sasimem/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { auth } from "../admin.js";
import { createOrgFor } from "../store/orgs.js";

export interface CreateOrgDeps {
  readonly now: () => Date;
}

export function makeCreateOrg(deps: CreateOrgDeps) {
  return onCall<OrgSetupInput, Promise<{ orgId: string }>>(async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) throw new HttpsError("unauthenticated", "Sign in first.");
    const setup = withOrgDefaults(request.data);
    const orgId = await createOrgFor(uid, setup, deps.now());
    await auth().setCustomUserClaims(uid, { orgIds: [orgId] });
    return { orgId };
  });
}

export const createOrg = makeCreateOrg({ now: () => new Date() });
