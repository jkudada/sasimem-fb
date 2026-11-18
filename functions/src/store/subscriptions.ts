/**
 * Subscriptions (PLAN-SUBSCRIBERS §6): the only server code that writes them.
 * The rules make the whole collection server-write-only (I9).
 */
import {
  applyOperatorAction, type CalendarDate, countsTowardLimit, draftRefusal, subscriptionStatus, type InviteTerms, localDate, newFreeSubscription, newTrialSubscription, type OperatorAction, planFrom, type PlanId,
  SUBSCRIPTION_TIMEZONE, type SubscriptionFields, type SubscriptionStatus, subscriptionDiff, TRIAL_DAYS, TRIAL_PLAN,
} from "@sasimem/core";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { db } from "../admin.js";

export const subscriptionRef = (orgId: string): DocumentReference => db().doc(`subscriptions/${orgId}`);
const counterRef = (): DocumentReference => db().doc("private/subscriptionCounter");

/** Sasimem's day: subscription dates are kept in Port Moresby time, whoever the landlord is. */
export const subscriptionToday = (now: Date): CalendarDate => localDate(now, SUBSCRIPTION_TIMEZONE);

/**
 * The reads a new subscription needs, done first because a transaction reads before it
 * writes. Returns the writes to make once the caller has decided to go ahead. A sign-up
 * gets the trial its invitation names (the standard one with no invitation); a free
 * invitation gets a free subscription, with no trial and no payment reference.
 */
export async function prepareSubscription(tx: Transaction, orgId: string, now: Date, terms: InviteTerms | null): Promise<() => void> {
  const { planId, trialDays } = terms ?? { planId: TRIAL_PLAN, trialDays: TRIAL_DAYS };
  const [planDoc, counter] = await Promise.all([tx.get(db().doc(`plans/${planId}`)), tx.get(counterRef())]);
  const plan = planFrom(planId, planDoc.data());
  if (planId === "free") {
    return () => tx.create(subscriptionRef(orgId), { ...newFreeSubscription({ plan, activeTenancyCount: 0 }), createdAt: now, updatedAt: now });
  }
  const referenceNumber = (counter.get("nextReference") as number | undefined) ?? 1;
  return () => {
    tx.create(subscriptionRef(orgId), {
      ...newTrialSubscription({ plan, today: subscriptionToday(now), referenceNumber, trialDays }),
      createdAt: now, updatedAt: now,
    });
    tx.set(counterRef(), { nextReference: referenceNumber + 1 });
  };
}

/**
 * Recount the org's tenancies that have not ended into its subscription, which the
 * tenancy create rule reads. A recount rather than +1/-1, so a lost or repeated event
 * cannot leave it wrong. Writes only when the number changed; no subscription, no write.
 */
export async function recountTenancies(orgId: string, now: Date): Promise<{ count: number; changed: boolean } | null> {
  const today = subscriptionToday(now);
  const tenancies = db().collection(`orgs/${orgId}/tenancies`);
  return db().runTransaction(async (tx) => {
    const [sub, all] = await Promise.all([tx.get(subscriptionRef(orgId)), tx.get(tenancies.select("endDate"))]);
    if (!sub.exists) return null;
    const count = all.docs.filter((t) => countsTowardLimit({ endDate: (t.get("endDate") as CalendarDate | null) ?? null }, today)).length;
    const changed = sub.get("activeTenancyCount") !== count;
    if (changed) tx.update(sub.ref, { activeTenancyCount: count, updatedAt: now });
    return { count, changed };
  });
}

// ---------------------------------------------------------------- enforcement (S4)

/** The subscription's fields, or null when the org has none (an org from before S1's backfill). */
export async function subscriptionOf(orgId: string): Promise<SubscriptionFields | null> {
  const snap = await subscriptionRef(orgId).get();
  return snap.exists ? fieldsOf(snap.data() ?? {}) : null;
}

/**
 * Why no new month may be drafted for this org now (D5), or null when it may. Worked out
 * from the dates today, so drafting stops on the day restriction begins, not when the
 * daily tick next writes the status. No subscription: drafting goes on (the tick logs it),
 * because a billing gap must never stop a landlord's invoices by accident.
 */
export async function draftBlock(orgId: string, now: Date): Promise<{ status: SubscriptionStatus; problem: string } | null> {
  const sub = await subscriptionOf(orgId);
  if (sub === null) return null;
  const status = subscriptionStatus(sub, subscriptionToday(now));
  const problem = draftRefusal(sub, status);
  return problem === null ? null : { status, problem };
}

export const SUBSCRIPTION_TICK = "subscription-tick";

/**
 * Bring one subscription's stored status up to what its dates say today, auditing the
 * change as the subscription tick's. A compare-and-set in a transaction: run twice, the
 * second finds nothing to change and writes nothing.
 */
export async function settleStatus(orgId: string, now: Date): Promise<{ from: SubscriptionStatus; to: SubscriptionStatus } | null> {
  const ref = subscriptionRef(orgId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const sub = fieldsOf(snap.data() ?? {});
    const to = subscriptionStatus(sub, subscriptionToday(now));
    if (to === sub.status) return null;
    tx.update(ref, { status: to, updatedAt: now });
    tx.create(db().collection("operatorEvents").doc(), {
      kind: "statusChange", orgId, actor: SUBSCRIPTION_TICK, actorEmail: null, at: now, before: { status: sub.status }, after: { status: to },
    });
    return { from: sub.status, to };
  });
}

/** Every subscription's org ID, or just the given ones (tests). */
export async function subscriptionIds(only?: readonly string[]): Promise<string[]> {
  if (only !== undefined) return [...only];
  return (await db().collection("subscriptions").select().get()).docs.map((d) => d.id);
}

// ---------------------------------------------------------------- operator actions (S3)

export interface Actor {
  readonly uid: string;
  readonly email: string;
}

export type StoredAction =
  | { readonly kind: "refused"; readonly problem: string }
  | { readonly kind: "noSubscription" }
  | { readonly kind: "done"; readonly status: SubscriptionStatus; readonly duplicate: boolean };

/** A bank reference as a payment's document ID: the same transfer typed twice is one payment. */
export const paymentId = (bankReference: string): string =>
  `bank-${encodeURIComponent(bankReference.trim().replace(/\s+/g, " ").toUpperCase())}`;

const TIMESTAMPS = new Set(["createdAt", "updatedAt"]);
const fieldsOf = (data: Record<string, unknown>): SubscriptionFields =>
  Object.fromEntries(Object.entries(data).filter(([k]) => !TIMESTAMPS.has(k))) as unknown as SubscriptionFields;

/**
 * Apply one operator action (core's applyOperatorAction) and audit it, in one
 * transaction: the subscription, any payment or note, the counter and one
 * operatorEvents entry are written together or not at all. A refusal writes nothing.
 */
export async function storeOperatorAction(orgId: string, action: OperatorAction, actor: Actor, now: Date): Promise<StoredAction> {
  const firestore = db();
  const ref = subscriptionRef(orgId);
  return firestore.runTransaction(async (tx): Promise<StoredAction> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "noSubscription" };
    const before = fieldsOf(snap.data() ?? {});
    const planId: PlanId = action.kind === "changePlan" ? action.planId : before.planId;
    const paymentRef = action.kind === "recordPayment" ? ref.collection("payments").doc(paymentId(action.bankReference)) : null;
    const [planDoc, counter, existingPayment] = await Promise.all([
      tx.get(firestore.doc(`plans/${planId}`)), tx.get(counterRef()), paymentRef === null ? null : tx.get(paymentRef),
    ]);
    if (existingPayment?.exists === true) return { kind: "done", status: before.status, duplicate: true };

    const referenceNumber = (counter.get("nextReference") as number | undefined) ?? 1;
    const result = applyOperatorAction(before, action, { today: subscriptionToday(now), plan: planFrom(planId, planDoc.data()), referenceNumber });
    if (!result.ok) return { kind: "refused", problem: result.problem };

    const diff = subscriptionDiff(before, result.sub);
    if (Object.keys(diff.after).length > 0) tx.update(ref, { ...diff.after, updatedAt: now });
    if (result.usedReference) tx.set(counterRef(), { nextReference: referenceNumber + 1 });
    let detail: Record<string, unknown> | undefined;
    if (action.kind === "recordPayment" && paymentRef !== null && result.payment !== undefined) {
      const { kind: _, ...paid } = action;
      detail = paid;
      tx.create(paymentRef, { ...paid, method: "bank", ...result.payment, recordedBy: actor.uid, at: now });
    }
    if (result.note !== undefined) {
      detail = { text: result.note };
      tx.create(ref.collection("notes").doc(), { text: result.note, by: actor.uid, byEmail: actor.email, at: now });
    }
    tx.create(firestore.collection("operatorEvents").doc(), {
      kind: action.kind, orgId, actor: actor.uid, actorEmail: actor.email, at: now, ...diff, ...(detail === undefined ? {} : { detail }),
    });
    return { kind: "done", status: result.sub.status, duplicate: false };
  });
}
