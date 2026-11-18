/**
 * The operator's actions (PLAN-SUBSCRIBERS §7, S3). One callable for every change to a
 * subscription, so no action can skip the guard: the caller must hold the `operator`
 * claim and have signed in with their second factor, as the rules' isOperator() asks.
 * The change itself is core's (subscription-actions.ts); store/ writes it with its audit
 * entry in one transaction. App Check is enforced for every callable (options.ts).
 */
import { operatorActionFrom, type SubscriptionStatus } from "@sasimem/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { Mailer } from "../mail/mailer.js";
import { MAIL_SECRETS } from "../params.js";
import { storeOperatorAction } from "../store/subscriptions.js";
import { operatorOf } from "./auth.js";
import { emailCancellation } from "./billing.js";
import { inviteCallable } from "./invites.js";

export interface OperatorDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  readonly appUrl: () => string;
}

export function makeOperatorCallables(deps: OperatorDeps) {
  return {
    operatorAction: onCall<unknown, Promise<{ status: SubscriptionStatus; duplicate: boolean }>>({ maxInstances: 2, secrets: MAIL_SECRETS }, async (request) => {
      const actor = operatorOf(request);
      const data = (request.data ?? {}) as { orgId?: unknown; action?: unknown };
      if (typeof data.orgId !== "string" || data.orgId === "" || data.orgId.includes("/")) {
        throw new HttpsError("invalid-argument", "Name the organisation.");
      }
      const action = operatorActionFrom(data.action);
      if ("problem" in action) throw new HttpsError("invalid-argument", action.problem);
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
