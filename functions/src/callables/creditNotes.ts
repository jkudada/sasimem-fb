/**
 * Credit notes (docs/PLAN-GENERAL-INVOICING.md AR-3; G2c): issue one against an invoice,
 * email it again, and fetch its PDF. Each re-checks that the caller owns the org; core's
 * rules decide what may be credited, inside the store's transaction.
 */
import type { CreditNoteInput } from "@sasimem/core";
import { logger } from "firebase-functions";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { bucket } from "../admin.js";
import { pdfFilename } from "../mail/templates.js";
import { type NotifyDeps, orRefused, sendCreditNote } from "../notify.js";
import { MAIL_SECRETS } from "../params.js";
import { issueCreditNote, storedCreditNote } from "../store/creditNotes.js";
import { creditNotePdfOf } from "../store/pdfs.js";
import { ownerOrg, uidOf } from "./auth.js";

export interface CreditNoteReply {
  readonly number: string;
  readonly message: string;
}

const ID = /^[A-Za-z0-9]{1,64}$/;
/** Invoice IDs: a draft's ID (one-off) or {tenancyId}_{period} (rent). */
const INVOICE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const UNREADABLE = "That credit note could not be read. Reload and try again.";

function creditNoteIdOf(request: CallableRequest<unknown>): string {
  const id = (request.data as { creditNoteId?: unknown }).creditNoteId;
  if (typeof id !== "string" || !ID.test(id)) throw new HttpsError("invalid-argument", UNREADABLE);
  return id;
}

/** The credit note as sent, in shape only; whether it makes sense is core's call, in the transaction. */
function inputOf(request: CallableRequest<unknown>): CreditNoteInput {
  const d = request.data as Record<string, unknown>;
  const { invoiceId, reason, lines } = d;
  if (typeof invoiceId !== "string" || !INVOICE_ID.test(invoiceId)) throw new HttpsError("invalid-argument", UNREADABLE);
  if (typeof reason !== "string" || reason.length > 500) throw new HttpsError("invalid-argument", UNREADABLE);
  if (!Array.isArray(lines) || lines.length > 50) throw new HttpsError("invalid-argument", UNREADABLE);
  return {
    invoiceId, reason,
    lines: lines.map((l: unknown) => {
      const x = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
      if (typeof x["lineIndex"] !== "number" || typeof x["amountToea"] !== "number") throw new HttpsError("invalid-argument", UNREADABLE);
      return { lineIndex: x["lineIndex"], amountToea: x["amountToea"] as CreditNoteInput["lines"][number]["amountToea"] };
    }),
  };
}

async function issuedOne(orgId: string, id: string) {
  const cn = await storedCreditNote(orgId, id);
  if (cn === null) throw new HttpsError("not-found", "That credit note is not there any more. Reload and try again.");
  return cn;
}

export function makeCreditNoteCallables(deps: NotifyDeps) {
  return {
    issueCreditNote: onCall<unknown, Promise<CreditNoteReply>>({ secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const id = creditNoteIdOf(request);
      const input = inputOf(request);
      const emailIt = (request.data as { emailIt?: unknown }).emailIt === true;

      const outcome = await issueCreditNote(orgId, id, input, { actor: uidOf(request), now: deps.now() });
      switch (outcome.kind) {
        case "notEnabled":
          throw new HttpsError("failed-precondition", "Credit notes are not switched on for your account.");
        case "refused":
          throw new HttpsError("invalid-argument", outcome.message);
        case "alreadyIssued":
          await creditNotePdfOf(orgId, id); // a crash after the commit left it without one
          return { number: outcome.creditNote.number, message: `That credit note was already issued: ${outcome.creditNote.number}.` };
        case "issued": {
          const cn = await creditNotePdfOf(orgId, id);
          const issued = `Issued ${cn.number} for ${cn.invoiceNumber}, crediting ${cn.customerName}.`;
          if (!emailIt) return { number: cn.number, message: issued };
          // Only the call that issued it emails. The credit note stands whatever the email does.
          try {
            const to = await sendCreditNote(deps, orgId, id, cn);
            return { number: cn.number, message: `${issued} Emailed to ${to}.` };
          } catch (e) {
            logger.error("credit note email refused", { orgId, creditNoteId: id, error: e instanceof Error ? e.message : String(e) });
            return { number: cn.number, message: `${issued} It could not be emailed; try Email again later.` };
          }
        }
      }
    }),

    resendCreditNote: onCall<unknown, Promise<{ ok: true; message: string }>>({ secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const id = creditNoteIdOf(request);
      await issuedOne(orgId, id);
      const cn = await creditNotePdfOf(orgId, id);
      const to = await orRefused(sendCreditNote(deps, orgId, id, cn, true));
      return { ok: true, message: `Emailed ${cn.number} to ${to} again.` };
    }),

    creditNotePdf: onCall<unknown, Promise<{ filename: string; base64: string }>>(async (request) => {
      const orgId = await ownerOrg(request);
      const id = creditNoteIdOf(request);
      await issuedOne(orgId, id);
      const cn = await creditNotePdfOf(orgId, id);
      const [pdf] = await bucket().file(cn.pdfPath).download();
      return { filename: pdfFilename(cn.number), base64: pdf.toString("base64") };
    }),
  };
}
