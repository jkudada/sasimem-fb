/** The approval page as an HTTP function, behind Hosting's /a/** rewrite. */
import { onRequest } from "firebase-functions/v2/https";
import { APPROVAL_SIGNING_KEY, MAIL_SECRETS } from "../params.js";
import { handleApproval, type PageDeps } from "./approvalPage.js";
import { handleQuote, type QuotePageDeps } from "./quotePage.js";

export function makeApprovalPage(deps: PageDeps) {
  // invoker "public": the page is opened from an email by someone with no account, and
  // the signed link is the only credential. Declared here because a deploy that updates
  // an existing function re-applies a declared invoker, but leaves an undeclared one as is.
  // maxInstances: public means anyone can call its run.app URL directly, past Hosting. A
  // landlord's few clicks a month need one instance; the cap bounds what a flood can cost.
  return onRequest({ invoker: "public", maxInstances: 5, secrets: [APPROVAL_SIGNING_KEY, ...MAIL_SECRETS] }, async (req, res) => {
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, string | undefined>;
    const form = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
    const out = await handleApproval({ method: req.method, path: req.path, form }, deps);
    res.status(out.status).set(out.headers).send(out.body);
  });
}

/** The customer's quote page (G2q-b), behind Hosting's /q/** rewrite. Public for the same reasons. */
export function makeQuotePage(deps: QuotePageDeps) {
  return onRequest({ invoker: "public", maxInstances: 5, secrets: [APPROVAL_SIGNING_KEY, ...MAIL_SECRETS] }, async (req, res) => {
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, string | undefined>;
    const form = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
    const out = await handleQuote({ method: req.method, path: req.path, form }, deps);
    res.status(out.status).set(out.headers).send(out.body);
  });
}
