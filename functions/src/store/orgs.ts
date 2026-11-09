/**
 * The only code that writes organisations (plan §2.1: store/ is the only code that
 * touches Firestore on the server).
 */
import type { OrgSetup } from "@sasimem/core";
import { db } from "../admin.js";
import { prepareTrial } from "./subscriptions.js";

/** An invitation's document ID: the email, lower-case (signupInvites is server-only). */
export const inviteId = (email: string): string => email.trim().toLowerCase();

/**
 * Create an org, its owner, the user's org list and the org's trial subscription
 * (PLAN-SUBSCRIBERS S1), in one transaction. Returns the org ID, or null when
 * `invitedEmail` is given and has no unused invitation. The invitation is used up in
 * the same transaction, so one invitation makes one organisation.
 */
export async function createOrgFor(uid: string, setup: OrgSetup, now: Date, invitedEmail: string | null = null): Promise<string | null> {
  const firestore = db();
  const orgRef = firestore.collection("orgs").doc();
  const { firstInvoiceNumber, ...profile } = setup;
  const userRef = firestore.doc(`users/${uid}`);
  return firestore.runTransaction(async (tx) => {
    // One organisation per user (product §5). A retried or doubled call gets the same org back.
    const existing = (await tx.get(userRef)).get("orgIds") as string[] | undefined;
    if (existing !== undefined && existing[0] !== undefined) return existing[0];
    // Every read before any write (Firestore), and a refused invitation starts no trial.
    const invite = invitedEmail === null ? null : firestore.doc(`signupInvites/${inviteId(invitedEmail)}`);
    if (invite !== null) {
      const got = await tx.get(invite);
      const usedBy = got.get("usedBy") as string | null | undefined;
      if (!got.exists || (usedBy != null && usedBy !== uid)) return null;
    }
    const startTrial = await prepareTrial(tx, orgRef.id, now);
    if (invite !== null) tx.update(invite, { usedBy: uid, usedAt: now });
    tx.create(orgRef, { ...profile, createdAt: now });
    tx.create(orgRef.collection("members").doc(uid), { role: "owner", addedAt: now });
    // A landlord who already issued INV-0141 by hand continues at INV-0142 (plan A3).
    tx.create(orgRef.collection("private").doc("counter"), { nextInvoiceNumber: firstInvoiceNumber });
    tx.create(userRef, { orgIds: [orgRef.id] });
    startTrial();
    return orgRef.id;
  });
}
