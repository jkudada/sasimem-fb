/**
 * Subscriptions (PLAN-SUBSCRIBERS §6): the only server code that writes them.
 * The rules make the whole collection server-write-only (I9).
 */
import {
  type CalendarDate, countsTowardLimit, localDate, newTrialSubscription, planFrom, SUBSCRIPTION_TIMEZONE, TRIAL_PLAN,
} from "@sasimem/core";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { db } from "../admin.js";

export const subscriptionRef = (orgId: string): DocumentReference => db().doc(`subscriptions/${orgId}`);
const counterRef = (): DocumentReference => db().doc("private/subscriptionCounter");

/** Sasimem's day: subscription dates are kept in Port Moresby time, whoever the landlord is. */
export const subscriptionToday = (now: Date): CalendarDate => localDate(now, SUBSCRIPTION_TIMEZONE);

/**
 * The reads a new trial needs, done first because a transaction reads before it writes.
 * Returns the writes to make once the caller has decided to go ahead.
 */
export async function prepareTrial(tx: Transaction, orgId: string, now: Date): Promise<() => void> {
  const [planDoc, counter] = await Promise.all([tx.get(db().doc(`plans/${TRIAL_PLAN}`)), tx.get(counterRef())]);
  const plan = planFrom(TRIAL_PLAN, planDoc.data());
  const referenceNumber = (counter.get("nextReference") as number | undefined) ?? 1;
  return () => {
    tx.create(subscriptionRef(orgId), {
      ...newTrialSubscription({ plan, today: subscriptionToday(now), referenceNumber }),
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
export async function recountTenancies(orgId: string, now: Date): Promise<number | null> {
  const today = subscriptionToday(now);
  const tenancies = db().collection(`orgs/${orgId}/tenancies`);
  return db().runTransaction(async (tx) => {
    const [sub, all] = await Promise.all([tx.get(subscriptionRef(orgId)), tx.get(tenancies.select("endDate"))]);
    if (!sub.exists) return null;
    const count = all.docs.filter((t) => countsTowardLimit({ endDate: (t.get("endDate") as CalendarDate | null) ?? null }, today)).length;
    if (sub.get("activeTenancyCount") !== count) tx.update(sub.ref, { activeTenancyCount: count, updatedAt: now });
    return count;
  });
}
