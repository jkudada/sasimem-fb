/** The approval page as an HTTP function, behind Hosting's /a/** rewrite. */
import { onRequest } from "firebase-functions/v2/https";
import { APPROVAL_SIGNING_KEY, RESEND_API_KEY } from "../params.js";
import { handleApproval, type PageDeps } from "./approvalPage.js";

export function makeApprovalPage(deps: PageDeps) {
  return onRequest({ secrets: [APPROVAL_SIGNING_KEY, RESEND_API_KEY] }, async (req, res) => {
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, string | undefined>;
    const form = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
    const out = await handleApproval({ method: req.method, path: req.path, form }, deps);
    res.status(out.status).set(out.headers).send(out.body);
  });
}
