/**
 * Where invoice numbering starts (plan §4, A3). The counter is server only, not even
 * readable, so Settings reads and sets it here. Settable only before the first number
 * is issued; after that it belongs to the approval transaction (I3).
 */
import { firstInvoiceNumberProblem } from "@sasimem/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { type Numbering, readNumbering, setNext } from "../store/numbering.js";
import { ownerOrg } from "./auth.js";

export const getNumbering = onCall<{ orgId: string }, Promise<Numbering>>(async (request) => readNumbering(await ownerOrg(request)));

export const setNextInvoiceNumber = onCall<{ orgId: string; next: number }, Promise<Numbering>>(async (request) => {
  const orgId = await ownerOrg(request);
  const next = typeof request.data.next === "number" ? request.data.next : Number.NaN;
  const problem = firstInvoiceNumberProblem(next);
  if (problem !== null) throw new HttpsError("invalid-argument", problem);
  if (!(await setNext(orgId, next))) {
    throw new HttpsError("failed-precondition", "Invoices have already been numbered, so the next number cannot be changed.");
  }
  return { next, started: false };
});
