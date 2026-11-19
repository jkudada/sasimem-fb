/**
 * Part payments and receipts (docs/PLAN-GENERAL-INVOICING.md G2b): record a payment,
 * undo a mistaken one, and email a receipt again. Each re-checks that the caller owns the
 * org; core's rules decide what is allowed, inside the store's transaction.
 */
import { type PaymentInput, formatKina, undoReasonProblem } from "@sasimem/core";
import { logger } from "firebase-functions";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { type NotifyDeps, orRefused, sendReceipt } from "../notify.js";
import { MAIL_SECRETS } from "../params.js";
import { recordPayment, storedPayment, undoPayment } from "../store/receipts.js";
import { ownerOrg, uidOf } from "./auth.js";
import { plainly } from "./edits.js";

export interface PaymentReply {
  readonly receiptNumber: string;
  readonly message: string;
}

const ID = /^[A-Za-z0-9]{1,64}$/;
/** Invoice IDs: a draft's ID (one-off) or {tenancyId}_{period} (rent). */
const INVOICE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const UNREADABLE = "That payment could not be read. Reload and try again.";

function paymentIdOf(request: CallableRequest<unknown>): string {
  const id = (request.data as { paymentId?: unknown }).paymentId;
  if (typeof id !== "string" || !ID.test(id)) throw new HttpsError("invalid-argument", UNREADABLE);
  return id;
}

/** The payment as sent, in shape only; whether it makes sense is core's call, in the transaction. */
function paymentOf(request: CallableRequest<unknown>): PaymentInput {
  const d = request.data as Record<string, unknown>;
  const text = (k: string) => {
    const v = d[k] ?? "";
    if (typeof v !== "string" || v.length > 500) throw new HttpsError("invalid-argument", UNREADABLE);
    return v;
  };
  const allocations = d["allocations"];
  const used = d["creditUsedToea"];
  if (used !== undefined && typeof used !== "number") throw new HttpsError("invalid-argument", UNREADABLE);
  if (!Array.isArray(allocations) || allocations.length > 50) throw new HttpsError("invalid-argument", UNREADABLE);
  return {
    customerId: text("customerId"),
    receivedOn: text("receivedOn") as PaymentInput["receivedOn"],
    amountToea: (typeof d["amountToea"] === "number" ? d["amountToea"] : Number.NaN) as PaymentInput["amountToea"],
    method: text("method") as PaymentInput["method"],
    reference: text("reference"),
    note: text("note"),
    allocations: allocations.map((a: unknown) => {
      const x = (typeof a === "object" && a !== null ? a : {}) as Record<string, unknown>;
      if (typeof x["invoiceId"] !== "string" || !INVOICE_ID.test(x["invoiceId"]) || typeof x["amountToea"] !== "number") {
        throw new HttpsError("invalid-argument", UNREADABLE);
      }
      return { invoiceId: x["invoiceId"], amountToea: x["amountToea"] as PaymentInput["amountToea"] };
    }),
    ...(used === undefined ? {} : { creditUsedToea: used as PaymentInput["amountToea"] }),
  };
}

export function makeReceiptCallables(deps: NotifyDeps) {
  return {
    recordPayment: onCall<unknown, Promise<PaymentReply>>({ secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const paymentId = paymentIdOf(request);
      const input = paymentOf(request);
      const emailIt = (request.data as { emailReceipt?: unknown }).emailReceipt === true;

      const outcome = await recordPayment(orgId, paymentId, input, { actor: uidOf(request), now: deps.now() });
      switch (outcome.kind) {
        case "notEnabled":
          throw new HttpsError("failed-precondition", "Payments are not switched on for your account.");
        case "refused":
          throw new HttpsError("invalid-argument", outcome.message);
        case "alreadyRecorded":
          return {
            receiptNumber: outcome.payment.receiptNumber,
            message: outcome.payment.receiptNumber === "" ? "That was already recorded." : `That payment was already recorded: receipt ${outcome.payment.receiptNumber}.`,
          };
        case "recorded": {
          const p = outcome.payment;
          const used = p.creditUsedToea === undefined ? "" : ` and ${formatKina(p.creditUsedToea)} of their credit`;
          // Credit used, nothing received: no receipt, nobody emailed.
          if (p.receiptNumber === "") return { receiptNumber: "", message: `Used ${formatKina(p.creditUsedToea ?? (0 as PaymentInput["amountToea"]))} of ${p.customerName}'s credit. No money was received, so there is no receipt.` };
          const recorded = `Recorded ${formatKina(p.amountToea)}${used} from ${p.customerName}: receipt ${p.receiptNumber}.`;
          if (!emailIt) return { receiptNumber: p.receiptNumber, message: recorded };
          // Only the call that recorded it emails. The payment stands whatever the email does.
          try {
            const to = await sendReceipt(deps, orgId, paymentId, p);
            return { receiptNumber: p.receiptNumber, message: `${recorded} Emailed to ${to}.` };
          } catch (e) {
            logger.error("receipt email refused", { orgId, paymentId, error: e instanceof Error ? e.message : String(e) });
            return { receiptNumber: p.receiptNumber, message: `${recorded} The receipt could not be emailed; try Email receipt again later.` };
          }
        }
      }
    }),

    undoPayment: onCall<unknown, Promise<{ ok: true; message: string }>>(async (request) => {
      const orgId = await ownerOrg(request);
      const paymentId = paymentIdOf(request);
      const reason = typeof (request.data as { reason?: unknown }).reason === "string" ? ((request.data as { reason: string }).reason).trim() : "";
      const problem = undoReasonProblem(reason);
      if (problem !== null) throw new HttpsError("invalid-argument", problem);
      const undone = await plainly(() => undoPayment(orgId, paymentId, { actor: uidOf(request), now: deps.now(), reason }));
      return { ok: true, message: undone ? "Payment undone. Its invoices owe what they did before it." : "That payment was already undone." };
    }),

    resendReceipt: onCall<unknown, Promise<{ ok: true; message: string }>>({ secrets: MAIL_SECRETS }, async (request) => {
      const orgId = await ownerOrg(request);
      const paymentId = paymentIdOf(request);
      const payment = await storedPayment(orgId, paymentId);
      if (payment === null) throw new HttpsError("not-found", "That payment is not there any more. Reload and try again.");
      if (payment.status === "undone") throw new HttpsError("failed-precondition", "That payment was undone, so it has no receipt to send.");
      if (payment.receiptNumber === "") throw new HttpsError("failed-precondition", "That only used credit, so it has no receipt to send.");
      const to = await orRefused(sendReceipt(deps, orgId, paymentId, payment, true));
      return { ok: true, message: `Emailed receipt ${payment.receiptNumber} to ${to} again.` };
    }),
  };
}
