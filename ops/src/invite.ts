/**
 * Invitations to sign up (docs/PLAN-TEMPLATES.md §7). While SIGNUP_MODE is "invite",
 * createOrg admits only an email with an unused document in signupInvites, a
 * collection the browser can neither read nor write. The ID is the email in lower case,
 * as functions/src/store/orgs.ts looks it up.
 */
import type { ApiRequest } from "./appcheck.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function inviteEmail(raw: string | undefined): string {
  const email = (raw ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error(`Name the email to invite, like name@example.com${raw === undefined ? "" : ` (not "${raw}")`}.`);
  return email;
}

/** Create the invitation; Firestore answers 409 if one is already there, so it is never reset. */
export const inviteRequest = (project: string, email: string, now: Date): ApiRequest => ({
  method: "POST",
  url: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/signupInvites?documentId=${encodeURIComponent(email)}`,
  body: { fields: { invitedAt: { timestampValue: now.toISOString() } } },
});
