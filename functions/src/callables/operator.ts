/**
 * The operator's actions (PLAN-SUBSCRIBERS §7, S3). One callable for every change to a
 * subscription, so no action can skip the guard: the caller must be active staff signed
 * in with their second factor, as the rules' isStaff() asks, in a role that may take
 * the action (PLAN-ADMIN-DASHBOARD §4: notes for all but Viewers, the rest billing roles).
 * The change itself is core's (subscription-actions.ts); store/ writes it with its audit
 * entry in one transaction. App Check is enforced for every callable (options.ts).
 */
import { canTakeAction, operatorActionFrom, type SubscriptionStatus } from "@sasimem/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { Mailer } from "../mail/mailer.js";
import { MAIL_SECRETS } from "../params.js";
import { storeOperatorAction } from "../store/subscriptions.js";
import { consoleSettings } from "../store/staff.js";
import { allow, staffOf } from "./auth.js";
import { emailCancellation } from "./billing.js";
import { inviteCallable } from "./invites.js";

export const NOT_BILLING = "Only an Owner, a Manager or a Supervisor can change a subscription.";
export const NO_NOTES = "Viewers cannot add notes.";

export interface OperatorDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  readonly appUrl: () => string;
}

export function makeOperatorCallables(deps: OperatorDeps) {
  return {
    operatorAction: onCall<unknown, Promise<{ status: SubscriptionStatus; duplicate: boolean }>>({ maxInstances: 2, secrets: MAIL_SECRETS }, async (request) => {
      const actor = await staffOf(request);
      const data = (request.data ?? {}) as { orgId?: unknown; action?: unknown };
      if (typeof data.orgId !== "string" || data.orgId === "" || data.orgId.includes("/")) {
        throw new HttpsError("invalid-argument", "Name the organisation.");
      }
      const action = operatorActionFrom(data.action);
      if ("problem" in action) throw new HttpsError("invalid-argument", action.problem);
      allow(canTakeAction(actor.role, action.kind, await consoleSettings()), action.kind === "addNote" ? NO_NOTES : NOT_BILLING);
      const now = deps.now();
      const done = await storeOperatorAction(data.orgId, action, actor, now);
      switch (done.kind) {
        case "noSubscription": throw new HttpsError("not-found", "That organisation has no subscription.");
        case "refused": throw new HttpsError("failed-precondition", done.problem);
        case "done":
          // The landlord hears of a cancel at once, with the export link (S6).
          if (action.kind === "cancelSubscription") await emailCancellation(deps, data.orgId, now);
          return { status: done.status, duplicate: done.duplicate };
      }
    }),
    invite: inviteCallable(deps),
  };
}
