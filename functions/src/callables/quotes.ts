/**
 * Quotes (docs/PLAN-GENERAL-INVOICING.md §3.3; test list general-g2q.md). Send quote
 * numbers, freezes, renders and emails it, with the link the customer answers on (G2q-b).
 * The owner can also record the answer themselves (a call, signed paper), and undo an
 * acceptance until anything is invoiced from the quote.
 */
import { quoteLabel, readQuoteAnswer } from "@sasimem/core";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { type NotifyDeps, sendQuoteMail } from "../notify.js";
import { MAIL_SECRETS } from "../params.js";
import { answerQuote, quotePdfOf, sendQuote, undoAcceptance } from "../store/quotes.js";
import { ownerOrg, uidOf } from "./auth.js";

export interface SendQuoteReply {
  readonly number: string;
  readonly message: string;
}

const quoteIdOf = (data: unknown): string => {
  const id = (data as { quoteId?: unknown }).quoteId;
  if (typeof id !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(id)) throw new HttpsError("invalid-argument", "Choose a quote.");
  return id;
};
const NOT_FOUND = "That quote is not there any more.";

export function makeQuoteCallables(deps: NotifyDeps) {
  return {
    /** The owner records the customer's answer. No email: it is their own action. */
    markQuote: onCall<unknown, Promise<{ readonly message: string }>>(async (request) => {
      const orgId = await ownerOrg(request);
      const quoteId = quoteIdOf(request.data);
      const form = Object.fromEntries(["answer", "name", "poNumber", "reason"].map((k) => {
        const v = (request.data as Record<string, unknown>)[k];
        return [k, typeof v === "string" ? v : undefined];
      }));
      const read = readQuoteAnswer(form, "owner");
      if (!read.ok) throw new HttpsError("invalid-argument", Object.values(read.problems)[0] ?? "Choose to accept or decline.");
      const outcome = await answerQuote(orgId, quoteId, read.answer, { by: "owner", actor: uidOf(request), now: deps.now() });
      switch (outcome.kind) {
        case "notFound":
        case "superseded":
          throw new HttpsError("not-found", NOT_FOUND);
        case "refused":
          throw new HttpsError("failed-precondition", outcome.message);
        case "recorded": {
          const label = quoteLabel(outcome.quote.number, outcome.quote.revision);
          return { message: read.answer.kind === "accept" ? `Recorded: ${label} accepted by ${read.answer.name}.` : `Recorded: ${label} declined.` };
        }
      }
    }),

    undoAcceptance: onCall<unknown, Promise<{ readonly message: string }>>(async (request) => {
      const orgId = await ownerOrg(request);
      const outcome = await undoAcceptance(orgId, quoteIdOf(request.data), { actor: uidOf(request), now: deps.now() });
      switch (outcome.kind) {
        case "notFound":
          throw new HttpsError("not-found", NOT_FOUND);
        case "refused":
          throw new HttpsError("failed-precondition", outcome.message);
        case "undone":
          return { message: `${quoteLabel(outcome.quote.number, outcome.quote.revision)} is open again. The customer's link can accept it until it expires.` };
      }
    }),

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
