/**
 * One-off invoices (docs/PLAN-GENERAL-INVOICING.md G2a). Pressing Send is the say-so
 * (D7): the owner's call numbers, freezes, renders and emails in one go.
 */
import type { InvoiceDocument } from "@sasimem/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { type NotifyDeps, sendTenantInvoice } from "../notify.js";
import { MAIL_SECRETS } from "../params.js";
import { issueOneOff } from "../store/oneoff.js";
import { renderPdfOf } from "../store/pdfs.js";
import { refs } from "../store/runs.js";
import { ownerOrg, uidOf } from "./auth.js";

export interface IssueReply {
  readonly number: string;
  readonly message: string;
}

export function makeOneOffCallables(deps: NotifyDeps) {
  return {
    issueInvoice: onCall<unknown, Promise<IssueReply>>({ secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const draftId = (request.data as { draftId?: unknown }).draftId;
      if (typeof draftId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(draftId)) throw new HttpsError("invalid-argument", "Choose a draft to send.");

      const outcome = await issueOneOff(orgId, draftId, { actor: uidOf(request), now: deps.now() });
      switch (outcome.kind) {
        case "notFound":
          throw new HttpsError("not-found", "That draft is not there any more. It may have been sent or deleted.");
        case "notEnabled":
          throw new HttpsError("failed-precondition", "One-off invoices are not switched on for your account.");
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
  };
}
