/**
 * The subscriber's lifecycle emails (PLAN-SUBSCRIBERS §9, S5): welcome, the setup nudge,
 * the trial reminders, past due and restricted. Core decides which are due; each is
 * claimed with create() on `subscriptions/{orgId}/notices/{key}` before it is sent, so two
 * ticks send it once, and a failed send gives the claim back so the next tick tries again.
 * Every one goes through the org's email log.
 */
import { type BankDetails, type CalendarDate, type LifecycleNotice, lifecycleNoticesDue, localDate, subscriptionNotice, SUBSCRIPTION_TIMEZONE, type SubscriptionFields } from "@sasimem/core";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "./admin.js";
import { sendLogged } from "./mail/log.js";
import type { Mail, Mailer } from "./mail/mailer.js";
import { setupNudge, subscriptionLetter, welcome } from "./mail/templates.js";
import { subscriptionOf, subscriptionRef, subscriptionToday } from "./store/subscriptions.js";

export interface LifecycleDeps {
  readonly mailer: Mailer;
  readonly appUrl: () => string;
}

/** Firestore's code for a create() that found the document there. */
const ALREADY_EXISTS = 6;

/** The org's sign-up day, Port Moresby time; null for an org from before it was recorded. */
export const createdOnOf = (createdAt: unknown): CalendarDate | null =>
  createdAt !== null && typeof createdAt === "object" && "toDate" in createdAt ? localDate((createdAt as Timestamp).toDate(), SUBSCRIPTION_TIMEZONE) : null;

/** Claim one notice. False when it was already claimed (sent, or being sent by another tick). */
async function claim(orgId: string, notice: LifecycleNotice, now: Date): Promise<boolean> {
  try {
    await subscriptionRef(orgId).collection("notices").doc(notice.key).create({ kind: notice.kind, at: now });
    return true;
  } catch (e) {
    if ((e as { code?: unknown }).code === ALREADY_EXISTS) return false;
    throw e;
  }
}

function mailFor(notice: LifecycleNotice, to: { email: string; name: string }, sub: SubscriptionFields, today: CalendarDate, bank: BankDetails | null, appUrl: string): Mail | null {
  const base = { to: to.email, orgName: to.name, appUrl };
  switch (notice.kind) {
    case "welcome": return welcome({ ...base, trialEndsOn: sub.status === "trial" ? sub.trialEndsOn : null });
    case "setupNudge": return setupNudge(base);
    default: {
      const said = subscriptionNotice(sub, today, bank);
      return said === null ? null : subscriptionLetter({ ...base, title: said.title, body: said.body });
    }
  }
}

/**
 * Send every lifecycle email this org is due and has not been sent. Returns how many went.
 * One failure does not stop the others; the first is thrown after, so the tick retries.
 */
export async function sendLifecycleNotices(deps: LifecycleDeps, orgId: string, now: Date): Promise<number> {
  const [sub, org, tenancies, billing] = await Promise.all([
    subscriptionOf(orgId), db().doc(`orgs/${orgId}`).get(), db().collection(`orgs/${orgId}/tenancies`).limit(1).select().get(), db().doc("sasimem/billing").get(),
  ]);
  if (sub === null || !org.exists) return 0;
  const today = subscriptionToday(now);
  // No sign-up day recorded: an old org, too old for a welcome or a nudge.
  const createdOn = createdOnOf(org.get("createdAt")) ?? ("1970-01-01" as CalendarDate);
  const bank = billing.exists ? (billing.data() as BankDetails) : null;
  const to = { email: String(org.get("email") ?? ""), name: String(org.get("name") ?? "") };

  let sent = 0;
  const errors: unknown[] = [];
  for (const notice of lifecycleNoticesDue({ sub, createdOn, hasTenancy: !tenancies.empty }, today)) {
    const mail = mailFor(notice, to, sub, today, bank, deps.appUrl());
    if (mail === null || to.email === "" || !(await claim(orgId, notice, now))) continue;
    try {
      await sendLogged({ mailer: deps.mailer, now }, { orgId, kind: notice.kind, noticeKey: notice.key }, mail);
      sent++;
    } catch (e) {
      await subscriptionRef(orgId).collection("notices").doc(notice.key).delete(); // so the next tick tries again
      errors.push(e);
    }
  }
  if (errors.length > 0) throw errors[0];
  return sent;
}
