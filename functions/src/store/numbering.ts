/** The invoice counter, before numbering starts (plan §4). Approval (step 4) owns it after. */
import { db } from "../admin.js";

export interface Numbering {
  readonly next: number;
  /** True once any number has been issued; then the counter belongs to approval. */
  readonly started: boolean;
}

const counterOf = (orgId: string) => db().doc(`orgs/${orgId}/private/counter`);
const issuedOf = (orgId: string) => db().collection(`orgs/${orgId}/issuedNumbers`).limit(1);

export async function readNumbering(orgId: string): Promise<Numbering> {
  const [counter, issued] = await Promise.all([counterOf(orgId).get(), issuedOf(orgId).get()]);
  return { next: counter.get("nextInvoiceNumber") as number, started: !issued.empty };
}

/** Set the next number, in a transaction that also checks nothing has been issued. False if it has. */
export async function setNext(orgId: string, next: number): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    if (!(await tx.get(issuedOf(orgId))).empty) return false;
    tx.set(counterOf(orgId), { nextInvoiceNumber: next });
    return true;
  });
}

export async function isOwner(orgId: string, uid: string): Promise<boolean> {
  return (await db().doc(`orgs/${orgId}/members/${uid}`).get()).get("role") === "owner";
}
