/**
 * The welcome email goes when the subscription is made (PLAN-SUBSCRIBERS §9, S5), not the
 * next morning: createOrg makes it, and this sends what is due, which on sign-up is the
 * welcome. Claimed like every lifecycle email, so the daily tick's catch-up never sends it
 * twice; if this send fails, the tick sends it the next day (within the welcome's two days).
 * A backfilled subscription of an old org is due nothing, so the backfill emails no one.
 */
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { type LifecycleDeps, sendLifecycleNotices } from "../lifecycle.js";
import { MAIL_SECRETS } from "../params.js";

export function makeOnSubscriptionCreated(deps: LifecycleDeps & { readonly now: () => Date }) {
  return onDocumentCreated({ document: "subscriptions/{orgId}", secrets: MAIL_SECRETS }, async (event) => {
    try {
      await sendLifecycleNotices(deps, event.params.orgId, deps.now());
    } catch (e) {
      logger.error("welcome email not sent; the daily tick tries again", { orgId: event.params.orgId, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
