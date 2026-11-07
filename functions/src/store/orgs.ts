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
  const { firstInvoiceNumber: _first, ...profile } = setup;
  await firestore.runTransaction(async (tx) => {
    tx.create(orgRef, { ...profile, createdAt: now });
    tx.create(orgRef.collection("members").doc(uid), { role: "owner", addedAt: now });
    tx.set(firestore.doc(`users/${uid}`), { orgIds: [orgRef.id] });
  });
  return orgRef.id;
}
