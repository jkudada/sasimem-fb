/**
 * Setup validation (step 2): the plain-English problems with what a landlord
 * typed. Screens show these; security rules enforce the same limits; createOrg
 * refuses on any of them. Problems are messages, not exceptions.
 */
import type { OrgSetup, Problems } from "./types.js";

export const MAX_NAME = 100;

export function orgProblems(org: OrgSetup): Problems<keyof OrgSetup> {
  const p: Problems<keyof OrgSetup> = {};
  if (org.name.trim() === "") p.name = "Enter the name that goes on your invoices.";
  else if (org.name.length > MAX_NAME) p.name = `Keep the name to ${MAX_NAME} characters or fewer.`;
  return p;
}
