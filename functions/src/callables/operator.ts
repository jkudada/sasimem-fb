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
import { storeOperatorAction } from "../store/subscriptions.js";
import { operatorOf } from "./auth.js";
import { inviteCallable } from "./invites.js";

export interface OperatorDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  readonly appUrl: () => string;
}

export function makeOperatorCallables(deps: OperatorDeps) {
  return {
    operatorAction: onCall<unknown, Promise<{ status: SubscriptionStatus; duplicate: boolean }>>({ maxInstances: 2 }, async (request) => {
      const actor = operatorOf(request);
      const data = (request.data ?? {}) as { orgId?: unknown; action?: unknown };
      if (typeof data.orgId !== "string" || data.orgId === "" || data.orgId.includes("/")) {
        throw new HttpsError("invalid-argument", "Name the organisation.");
      }
      const action = operatorActionFrom(data.action);
      if ("problem" in action) throw new HttpsError("invalid-argument", action.problem);
      const done = await storeOperatorAction(data.orgId, action, actor, deps.now());
      switch (done.kind) {
        case "noSubscription": throw new HttpsError("not-found", "That organisation has no subscription.");
        case "refused": throw new HttpsError("failed-precondition", done.problem);
        case "done": return { status: done.status, duplicate: done.duplicate };
      }
    }),
    invite: inviteCallable(deps),
  };
}
