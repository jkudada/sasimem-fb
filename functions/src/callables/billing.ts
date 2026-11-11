/**
 * The landlord's side of their subscription (PLAN-SUBSCRIBERS §8, S4). Changing plan is
 * the operator's (an audited callable); the landlord asks for it, and Sasimem is emailed.
 * One ask per org per day, claimed with create() as I8 claims reminders, so a double
 * tap or a retry sends one email. The ask is in the audit trail for the console.
 */
import { defaultPlan, type Interval, type PlanId, usageText } from "@sasimem/core";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { Mailer } from "../mail/mailer.js";
import { planChangeRequest } from "../mail/templates.js";
import { MAIL_SECRETS } from "../params.js";
import { subscriptionOf, subscriptionRef, subscriptionToday } from "../store/subscriptions.js";
import { ownerOrg, uidOf } from "./auth.js";

export const MAX_PLAN_MESSAGE = 1000;
const PLANS: readonly PlanId[] = ["free", "standard", "plus"];
const INTERVALS: readonly Interval[] = ["annual", "monthly"];

export interface BillingDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  /** Where asks go when `sasimem/billing` names no contactEmail: the sending address. */
  readonly fallbackContact: () => string;
}

const label = (planId: PlanId, interval: Interval): string =>
  planId === "free" ? "Free" : `${defaultPlan(planId).name}, paid ${interval === "annual" ? "annually" : "quarterly"}`;

export function makeBillingCallables(deps: BillingDeps) {
  return {
    requestPlanChange: onCall<unknown, Promise<{ message: string }>>({ maxInstances: 2, secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const data = request.data as { planId?: unknown; interval?: unknown; message?: unknown };
      const planId = data.planId as PlanId;
      const interval = data.interval as Interval;
      if (!PLANS.includes(planId) || !INTERVALS.includes(interval)) throw new HttpsError("invalid-argument", "Choose a plan and how often to pay.");
      const message = typeof data.message === "string" ? data.message.trim() : "";
      if (message.length > MAX_PLAN_MESSAGE) throw new HttpsError("invalid-argument", `Keep the message under ${MAX_PLAN_MESSAGE} characters.`);

      const now = deps.now();
      const [sub, org, billing] = await Promise.all([subscriptionOf(orgId), db().doc(`orgs/${orgId}`).get(), db().doc("sasimem/billing").get()]);
      if (sub === null) throw new HttpsError("failed-precondition", "Your organisation has no subscription yet. Contact Sasimem.");
      if (sub.planId === planId && (planId === "free" || sub.interval === interval)) throw new HttpsError("invalid-argument", "That is the plan you are on.");

      const ownerEmail = String(request.auth?.token.email ?? org.get("email") ?? "");
      const contact = billing.get("contactEmail") as string | undefined;
      const claim = subscriptionRef(orgId).collection("notices").doc(`planRequest_${subscriptionToday(now)}`);
      try {
        await claim.create({ at: now, planId, interval });
      } catch {
        throw new HttpsError("already-exists", "You have already asked today. Sasimem will reply by email.");
      }
      try {
        await deps.mailer.send(planChangeRequest({
          to: typeof contact === "string" && contact !== "" ? contact : deps.fallbackContact(),
          orgName: String(org.get("name") ?? orgId), orgId, ownerEmail,
          current: label(sub.planId, sub.interval), wanted: label(planId, interval), usage: usageText(sub), message,
        }));
      } catch (e) {
        await claim.delete(); // so asking again sends it
        logger.error("plan change request email refused", { orgId, error: e instanceof Error ? e.message : String(e) });
        throw new HttpsError("aborted", "Your request could not be sent. Please try again in a few minutes.");
      }
      await db().collection("operatorEvents").add({
        kind: "planChangeRequested", orgId, actor: uidOf(request), actorEmail: ownerEmail, at: now, before: {}, after: {},
        detail: { planId, interval, ...(message === "" ? {} : { message }) },
      });
      return { message: `Sasimem has your request and will reply to ${ownerEmail}.` };
    }),
  };
}
