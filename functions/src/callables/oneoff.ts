/**
 * One-off invoices (docs/PLAN-GENERAL-INVOICING.md G2a). Pressing Send is the say-so
 * (D7): the owner's call numbers, freezes, renders and emails in one go. Send later (G2d)
 * is the same say-so given ahead: the tick sends it on the day.
 */
import type { InvoiceDocument } from "@sasimem/core";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { type NotifyDeps, sendTenantInvoice } from "../notify.js";
import { MAIL_SECRETS } from "../params.js";
import { issueOneOff } from "../store/oneoff.js";
import { cancelSend, scheduleSend } from "../store/sendLater.js";
import { renderPdfOf } from "../store/pdfs.js";
import { refs } from "../store/runs.js";
import { ownerOrg, uidOf } from "./auth.js";

export interface IssueReply {
  readonly number: string;
  readonly message: string;
}

const NOT_ENABLED = "One-off invoices are not switched on for your account.";
const GONE = "That draft is not there any more. It may have been sent or deleted.";

function draftIdOf(request: CallableRequest<unknown>): string {
  const draftId = (request.data as { draftId?: unknown }).draftId;
  if (typeof draftId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(draftId)) throw new HttpsError("invalid-argument", "Choose a draft to send.");
  return draftId;
}

export function makeOneOffCallables(deps: NotifyDeps) {
  return {
    issueInvoice: onCall<unknown, Promise<IssueReply>>({ secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const draftId = draftIdOf(request);

      const outcome = await issueOneOff(orgId, draftId, { actor: uidOf(request), now: deps.now() });
      switch (outcome.kind) {
        case "notFound":
        case "notDue": // only the tick asks for a scheduled send
          throw new HttpsError("not-found", GONE);
        case "notEnabled":
          throw new HttpsError("failed-precondition", NOT_ENABLED);
        case "refused":
          throw new HttpsError("invalid-argument", outcome.message);
        case "alreadyIssued":
          await renderPdfOf(orgId, draftId); // a crash after the commit left it without one
          return { number: outcome.number, message: `${outcome.number} was already sent.` };
        case "issued": {
          await renderPdfOf(orgId, draftId);
          const invoice = (await refs(orgId).invoice(draftId).get()).data() as InvoiceDocument;
          // Only the call that issued it emails: a second press finds it issued and sends nothing.
          await sendTenantInvoice(deps, orgId, draftId, invoice);
          return { number: outcome.number, message: `Sent ${outcome.number} to ${outcome.customerName}.` };
        }
      }
    }),

    /** Send later (G2d): checked now as Send would check it, numbered and sent by the tick on the day. */
    scheduleInvoice: onCall<unknown, Promise<{ sendAt: string; message: string }>>(async (request) => {
      const orgId = await ownerOrg(request);
      const draftId = draftIdOf(request);
      const sendOn = (request.data as { sendOn?: unknown }).sendOn;
      const outcome = await scheduleSend(orgId, draftId, typeof sendOn === "string" ? sendOn.slice(0, 20) : "", { actor: uidOf(request), now: deps.now() });
      switch (outcome.kind) {
        case "notFound":
          throw new HttpsError("not-found", GONE);
        case "notEnabled":
          throw new HttpsError("failed-precondition", NOT_ENABLED);
        case "refused":
          throw new HttpsError("invalid-argument", outcome.message);
        case "scheduled":
          return { sendAt: outcome.sendAt.toISOString(), message: `${outcome.customerName}'s invoice goes on ${outcome.label}. It is numbered then.` };
      }
    }),

    cancelSchedule: onCall<unknown, Promise<{ message: string }>>(async (request) => {
      const orgId = await ownerOrg(request);
      const draftId = draftIdOf(request);
      const cancelled = await cancelSend(orgId, draftId, { actor: uidOf(request), now: deps.now() });
      return { message: cancelled ? "It will not be sent. It stays a draft." : "It was not scheduled. It stays a draft." };
    }),
  };
}
