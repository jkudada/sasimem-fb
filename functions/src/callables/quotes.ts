/**
 * Quotes (docs/PLAN-GENERAL-INVOICING.md §3.3; test list general-g2q.md). Send quote
 * numbers, freezes, renders and emails it, with the link the customer answers on (G2q-b).
 */
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { type NotifyDeps, sendQuoteMail } from "../notify.js";
import { MAIL_SECRETS } from "../params.js";
import { quotePdfOf, sendQuote } from "../store/quotes.js";
import { ownerOrg, uidOf } from "./auth.js";

export interface SendQuoteReply {
  readonly number: string;
  readonly message: string;
}

export function makeQuoteCallables(deps: NotifyDeps) {
  return {
    sendQuote: onCall<unknown, Promise<SendQuoteReply>>({ secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const draftId = (request.data as { draftId?: unknown }).draftId;
      if (typeof draftId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(draftId)) throw new HttpsError("invalid-argument", "Choose a quote to send.");

      const token = deps.newToken();
      const outcome = await sendQuote(orgId, draftId, { actor: uidOf(request), now: deps.now(), token });
      switch (outcome.kind) {
        case "notFound":
          throw new HttpsError("not-found", "That quote is not there any more. It may have been sent or deleted.");
        case "notEnabled":
          throw new HttpsError("failed-precondition", "Quotes are not switched on for your account.");
        case "refused":
          throw new HttpsError("invalid-argument", outcome.message);
        case "alreadySent":
          await quotePdfOf(orgId, draftId); // a crash after the commit left it without one
          return { number: outcome.quote.number, message: `${outcome.quote.number} was already sent.` };
        case "sent": {
          const q = await quotePdfOf(orgId, draftId);
          const sent = `Sent ${q.number} to ${q.customerName}.`;
          // Only the call that sent it emails, with the link only it holds. The quote stands whatever the email does.
          try {
            await sendQuoteMail(deps, orgId, draftId, q, token);
            return { number: q.number, message: sent };
          } catch (e) {
            logger.error("quote email refused", { orgId, quoteId: draftId, error: e instanceof Error ? e.message : String(e) });
            return { number: q.number, message: `${q.number} is numbered, but the email to ${q.snapshot.tenantEmail} was refused. Check the address.` };
          }
        }
      }
    }),
  };
}
