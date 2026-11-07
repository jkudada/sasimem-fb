/**
 * createOrg (plan §6.2): the org, the owner membership, the counter and the
 * custom claim. The browser cannot create an org itself (I9).
 */
import { type OrgSetup, type OrgSetupInput, orgProblems, withOrgDefaults } from "@sasimem/core";
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
    const setup = readOrgSetup(request.data);
    const problems = orgProblems(setup);
    const first = Object.values(problems)[0];
    if (first !== undefined) throw new HttpsError("invalid-argument", first, { problems });
    const orgId = await createOrgFor(uid, setup, deps.now());
    await auth().setCustomUserClaims(uid, { orgIds: [orgId] });
    return { orgId };
  });
}

const TEXT = ["name", "address", "email", "gstNumber", "bankName", "bankAccount", "invoicePrefix", "timezone"] as const;
const WHOLE = ["approvalLeadDays", "sendHour", "reminderAfterDays", "firstInvoiceNumber"] as const;

/**
 * Check the shape of untrusted input before any rule sees it: strings are strings,
 * numbers are numbers. The rules themselves (limits, GST) are core's orgProblems.
 */
function readOrgSetup(data: unknown): OrgSetup {
  const bad = () => new HttpsError("invalid-argument", "That does not look like organisation details.");
  if (typeof data !== "object" || data === null) throw bad();
  const setup = withOrgDefaults(data as OrgSetupInput);
  const fields = setup as unknown as Record<string, unknown>;
  if (TEXT.some((k) => typeof fields[k] !== "string")) throw bad();
  if (WHOLE.some((k) => typeof fields[k] !== "number")) throw bad();
  if (typeof setup.gstRegistered !== "boolean" || (setup.reminderMode !== "auto" && setup.reminderMode !== "off")) throw bad();
  return setup;
}

export const createOrg = makeCreateOrg({ now: () => new Date() });
