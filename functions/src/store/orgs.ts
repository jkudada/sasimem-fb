/**
 * The only code that writes organisations (plan §2.1: store/ is the only code that
 * touches Firestore on the server).
 */
import type { OrgSetup } from "@sasimem/core";
import { db } from "../admin.js";

/** Create an org, its owner and the user's org list, in one transaction. Returns the org ID. */
export async function createOrgFor(uid: string, setup: OrgSetup, now: Date): Promise<string> {
  const firestore = db();
  const orgRef = firestore.collection("orgs").doc();
  const { firstInvoiceNumber, ...profile } = setup;
  const userRef = firestore.doc(`users/${uid}`);
  return firestore.runTransaction(async (tx) => {
    // One organisation per user (product §5). A retried or doubled call gets the same org back.
    const existing = (await tx.get(userRef)).get("orgIds") as string[] | undefined;
    if (existing !== undefined && existing[0] !== undefined) return existing[0];
    tx.create(orgRef, { ...profile, createdAt: now });
    tx.create(orgRef.collection("members").doc(uid), { role: "owner", addedAt: now });
    // A landlord who already issued INV-0141 by hand continues at INV-0142 (plan A3).
    tx.create(orgRef.collection("private").doc("counter"), { nextInvoiceNumber: firstInvoiceNumber });
    tx.create(userRef, { orgIds: [orgRef.id] });
    return orgRef.id;
  });
}
