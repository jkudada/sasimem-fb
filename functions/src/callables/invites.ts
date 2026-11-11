/**
 * Invitations (PLAN-SUBSCRIBERS S3, extending docs/PLAN-TEMPLATES.md §7). An operator
 * sends one with a plan, a trial length and an expiry, and it is emailed with the
 * sign-up link; sending again re-sends it with the terms given. A used invitation is
 * the subscriber's record of signing up and is never changed. Audited like every
 * operator change. signupInvites is server-only to the browser; operators read it.
 */
import { type InviteRequest, inviteRequestFrom } from "@sasimem/core";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { Mailer } from "../mail/mailer.js";
import { invitation } from "../mail/templates.js";
import { MAIL_SECRETS } from "../params.js";
import { operatorOf } from "./auth.js";

const USED = "That invitation has been used: the subscriber has signed up.";
const DAY_MS = 86_400_000;

export function inviteCallable(deps: { now: () => Date; mailer: Mailer; appUrl: () => string }) {
  return onCall<unknown, Promise<{ emailed: boolean }>>({ maxInstances: 2, secrets: MAIL_SECRETS }, async (request) => {
    const actor = operatorOf(request);
    const req = inviteRequestFrom(request.data);
    if ("problem" in req) throw new HttpsError("invalid-argument", req.problem);
    const now = deps.now();
    const ref = db().doc(`signupInvites/${req.email}`);
    const event = (detail: Record<string, unknown>) =>
      ({ kind: req.kind === "send" ? "invite" : "revokeInvite", actor: actor.uid, actorEmail: actor.email, at: now, before: {}, after: {}, detail });

    if (req.kind === "revoke") {
      await db().runTransaction(async (tx) => {
        const got = await tx.get(ref);
        if (!got.exists) throw new HttpsError("not-found", "There is no invitation for that email.");
        if (got.get("usedBy") != null) throw new HttpsError("failed-precondition", USED);
        tx.delete(ref);
        tx.create(db().collection("operatorEvents").doc(), event({ email: req.email }));
      });
      return { emailed: false };
    }

    const expiresAt = new Date(now.getTime() + req.expiresInDays * DAY_MS);
    await saveInvitation(req, expiresAt, now, actor, event);
    try {
      await deps.mailer.send(invitation({ to: req.email, planId: req.planId, trialDays: req.trialDays, link: `${deps.appUrl()}/sign-up`, expiresAt }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("invitation email refused", { error: message });
      await ref.update({ lastError: message });
      throw new HttpsError("aborted", "The invitation is saved, but its email could not be sent. Try sending it again in a few minutes.");
    }
    await ref.update({ lastSentAt: now, sendCount: FieldValue.increment(1), lastError: null });
    return { emailed: true };
  });
}

async function saveInvitation(
  req: Extract<InviteRequest, { kind: "send" }>, expiresAt: Date, now: Date, actor: { uid: string; email: string },
  event: (detail: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const ref = db().doc(`signupInvites/${req.email}`);
  await db().runTransaction(async (tx) => {
    const got = await tx.get(ref);
    if (got.get("usedBy") != null) throw new HttpsError("failed-precondition", USED);
    const terms = { planId: req.planId, trialDays: req.trialDays, expiresAt, invitedBy: actor.uid, invitedByEmail: actor.email };
    if (got.exists) tx.update(ref, terms);
    else tx.create(ref, { ...terms, invitedAt: now, usedBy: null, lastSentAt: null, sendCount: 0, lastError: null });
    tx.create(db().collection("operatorEvents").doc(), event({ email: req.email, planId: req.planId, trialDays: req.trialDays, expiresAt }));
  });
}
