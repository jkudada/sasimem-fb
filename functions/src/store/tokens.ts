/**
 * Approval tokens (plan §6.1, §6.4 steps 2 and 4, I10). approvalTokens/{sha256(token)}
 * maps a link to its org and period. A replaced token is marked, not deleted, so its
 * old link can still offer "email me a fresh link" - which always goes to the org's
 * address on file. The run keeps only hashes: approvalTokenId (the newest) and
 * approvalTokenIds (every link still live).
 */
import { type Period, type RunStatus, approvalTarget, holdDue } from "@sasimem/core";
import { type DocumentSnapshot, Timestamp, type Transaction } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { tokenId } from "../links.js";
import { refs } from "./runs.js";

const TOKEN_LIFE_MS = 7 * 86_400_000;
const tokenDoc = (id: string) => db().doc(`approvalTokens/${id}`);

const liveIds = (run: DocumentSnapshot): string[] => {
  const ids = run.get("approvalTokenIds") as string[] | undefined;
  if (ids !== undefined) return ids;
  const one = run.get("approvalTokenId") as string | null | undefined;
  return one == null ? [] : [one];
};

/** A new token for orgId/period, expiring a week from now. Returns the run fields that name it. */
function addToken(tx: Transaction, orgId: string, period: Period, now: Date, token: string, keep: readonly string[]) {
  const expiresAt = Timestamp.fromMillis(now.getTime() + TOKEN_LIFE_MS);
  const id = tokenId(token);
  tx.create(tokenDoc(id), { orgId, period, expiresAt, replacedAt: null });
  return { approvalTokenId: id, approvalTokenIds: [...keep, id], approvalSentAt: Timestamp.fromDate(now), approvalExpiresAt: expiresAt };
}

export type RequestOutcome =
  | { readonly requested: true; readonly target: "awaitingApproval" | "held" }
  | { readonly requested: false; readonly status: RunStatus | null };

/**
 * Compare-and-set draft → awaitingApproval with a new token; or straight to held when
 * the send time has already passed (core.approvalTarget). Only the caller that wins
 * should email.
 */
export async function requestApproval(orgId: string, period: Period, now: Date, token: string): Promise<RequestOutcome> {
  const run = refs(orgId).run(period);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(run);
    const status = (snap.get("status") as RunStatus | undefined) ?? null;
    if (status !== "draft") return { requested: false, status };
    const target = approvalTarget({ sendAt: (snap.get("sendAt") as Timestamp).toDate() }, now);
    tx.update(run, {
      status: target, ...addToken(tx, orgId, period, now, token, []),
      ...(target === "held" ? { heldNotifiedAt: Timestamp.fromDate(now) } : {}),
    });
    return { requested: true, target };
  });
}

/**
 * Compare-and-set awaitingApproval → held at the send time (§6.4 step 4). Every live
 * link gets 7 more days, and a new one is added for the held notice: the database
 * keeps only hashes, so the notice cannot repeat the digest's link. False if another
 * tick won, or the run is not due.
 */
export async function holdRun(orgId: string, period: Period, now: Date, token: string): Promise<boolean> {
  const run = refs(orgId).run(period);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(run);
    const status = snap.get("status") as RunStatus | undefined;
    if (status === undefined || !holdDue({ status, sendAt: (snap.get("sendAt") as Timestamp).toDate() }, now)) return false;
    const keep = liveIds(snap);
    const fields = addToken(tx, orgId, period, now, token, keep);
    for (const id of keep) tx.update(tokenDoc(id), { expiresAt: fields.approvalExpiresAt });
    tx.update(run, { status: "held", ...fields, heldNotifiedAt: Timestamp.fromDate(now) });
    return true;
  });
}

/** Replace every live link of a waiting run with one new one (another 7 days). False if the run is not waiting for approval. */
export async function replaceToken(orgId: string, period: Period, now: Date, token: string): Promise<boolean> {
  const run = refs(orgId).run(period);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(run);
    const status = snap.get("status") as RunStatus | undefined;
    if (status !== "awaitingApproval" && status !== "held") return false;
    for (const id of liveIds(snap)) tx.update(tokenDoc(id), { replacedAt: Timestamp.fromDate(now) });
    tx.update(run, addToken(tx, orgId, period, now, token, []));
    return true;
  });
}

export type TokenLookup =
  | { readonly state: "live"; readonly orgId: string; readonly period: Period }
  | { readonly state: "dead"; readonly orgId: string; readonly period: Period } // expired or replaced
  | { readonly state: "unknown" };

export async function lookupToken(token: string, now: Date): Promise<TokenLookup> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { state: "unknown" };
  const snap = await tokenDoc(tokenId(token)).get();
  if (!snap.exists) return { state: "unknown" };
  const orgId = snap.get("orgId") as string;
  const period = snap.get("period") as Period;
  const expired = (snap.get("expiresAt") as Timestamp).toMillis() <= now.getTime();
  const replaced = snap.get("replacedAt") !== null;
  return expired || replaced ? { state: "dead", orgId, period } : { state: "live", orgId, period };
}
