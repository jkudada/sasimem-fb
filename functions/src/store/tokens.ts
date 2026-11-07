/**
 * Approval tokens (plan §6.1, §6.4 step 2, I10). approvalTokens/{sha256(token)} maps a
 * link to its org and period. A replaced token is marked, not deleted, so its old
 * link can still offer "email me a fresh link" - which always goes to the org's
 * address on file. The run keeps only the current token's hash.
 */
import { type Period, type RunStatus } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { tokenId } from "../links.js";
import { refs } from "./runs.js";

const TOKEN_LIFE_MS = 7 * 86_400_000;
const tokenDoc = (id: string) => db().doc(`approvalTokens/${id}`);

export type RequestOutcome = { readonly requested: true } | { readonly requested: false; readonly status: RunStatus | null };

/** Compare-and-set draft → awaitingApproval with a new token. Only the caller that wins should email. */
export async function requestApproval(orgId: string, period: Period, now: Date, token: string): Promise<RequestOutcome> {
  const run = refs(orgId).run(period);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(run);
    const status = (snap.get("status") as RunStatus | undefined) ?? null;
    if (status !== "draft") return { requested: false, status };
    const expiresAt = Timestamp.fromMillis(now.getTime() + TOKEN_LIFE_MS);
    tx.create(tokenDoc(tokenId(token)), { orgId, period, expiresAt, replacedAt: null });
    tx.update(run, { status: "awaitingApproval", approvalTokenId: tokenId(token), approvalSentAt: Timestamp.fromDate(now), approvalExpiresAt: expiresAt });
    return { requested: true };
  });
}

/** Replace a waiting run's token with a new one (another 7 days). False if the run is not waiting for approval. */
export async function replaceToken(orgId: string, period: Period, now: Date, token: string): Promise<boolean> {
  const run = refs(orgId).run(period);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(run);
    const status = snap.get("status") as RunStatus | undefined;
    if (status !== "awaitingApproval" && status !== "held") return false;
    const old = snap.get("approvalTokenId") as string | undefined;
    if (old !== undefined) tx.update(tokenDoc(old), { replacedAt: Timestamp.fromDate(now) });
    const expiresAt = Timestamp.fromMillis(now.getTime() + TOKEN_LIFE_MS);
    tx.create(tokenDoc(tokenId(token)), { orgId, period, expiresAt, replacedAt: null });
    tx.update(run, { approvalTokenId: tokenId(token), approvalSentAt: Timestamp.fromDate(now), approvalExpiresAt: expiresAt });
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
