/**
 * The customer's quote page (docs/PLAN-GENERAL-INVOICING.md §3.3; test list general-g2q.md
 * G2q-b): GET /q/{token} shows the quote and marks it viewed; GET /q/{token}/pdf is its
 * frozen PDF; POST /q/{token} accepts or declines it, once. Server-rendered, no JavaScript,
 * the approval page's look and headers. The link is the only credential; forms carry a
 * nonce signed for it, as the approval page's do.
 */
import { createHash } from "node:crypto";
import {
  type QuoteAnswerField, type Toea, dateLabel, formatKina, formatQuantity, noAnswerReason, quoteAllows, quoteExpired, quoteLabel, readQuoteAnswer,
} from "@sasimem/core";
import { logger } from "firebase-functions";
import { bucket } from "../admin.js";
import { checkNonce, makeNonce } from "../links.js";
import { pdfFilename, whenLabel } from "../mail/templates.js";
import { type NotifyDeps, sendQuoteAnswered } from "../notify.js";
import { type StoredQuote, answerQuote, lookupQuoteToken, markViewed, quotePdfOf, quotesOf } from "../store/quotes.js";
import { refs } from "../store/runs.js";
import { type PageRequest, STYLE } from "./approvalPage.js";

export interface QuotePageDeps extends NotifyDeps {
  readonly signingKey: () => string;
}

export interface QuotePageResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string | Buffer;
}

type Typed = { readonly form: PageRequest["form"]; readonly problems: Partial<Record<QuoteAnswerField, string>> };

export async function handleQuote(req: PageRequest, deps: QuotePageDeps): Promise<QuotePageResponse> {
  const match = /\/q\/([^/]+)(?:\/(pdf))?\/?$/.exec(req.path);
  if (match === null) return page(404, "Link not recognised", NOT_FOUND);
  const token = match[1] ?? "";
  const now = deps.now();
  const link = await lookupQuoteToken(token, now);
  if (link.state === "unknown") return page(404, "Link not recognised", NOT_FOUND);
  const q = (await quotesOf(link.orgId).doc(link.quoteId).get()).data() as StoredQuote | undefined;
  if (q === undefined) return page(404, "Link not recognised", NOT_FOUND);
  const org = q.snapshot.org;
  const label = quoteLabel(q.number, q.revision);

  if (link.state === "dead") {
    return page(410, "This link no longer works", `<h1>This link no longer works</h1><p>Quote ${esc(label)} from ${esc(org.name)} ended on ${esc(dateLabel(q.validUntil))}.</p>${contact(q)}`);
  }
  if (link.revision !== q.revision) {
    return page(410, `Quote ${label}`, `<h1>This quote was replaced</h1><p>${esc(org.name)} replaced it with revision ${q.revision}. Use the link in their latest email.</p>${contact(q)}`);
  }

  if (match[2] === "pdf") {
    const withPdf = await quotePdfOf(link.orgId, link.quoteId);
    const [pdf] = await bucket().file(withPdf.pdfPath).download();
    return { status: 200, headers: { ...BASE, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfFilename(label)}"` }, body: pdf };
  }

  const timezone = ((await refs(link.orgId).org.get()).get("timezone") as string | undefined) ?? "Pacific/Port_Moresby";
  const nonce = () => makeNonce(deps.signingKey(), token, now);

  if (req.method === "POST") {
    if (!checkNonce(deps.signingKey(), token, req.form["nonce"] ?? "", now)) {
      return page(400, "Please try again", `<h1>Please try again</h1><p>This page was open too long. <a href="/q/${esc(token)}">Reload it</a> and try again. Nothing was recorded.</p>`);
    }
    const read = readQuoteAnswer(req.form, "customer");
    if (!read.ok) return page(422, `Quote ${label}`, quotePage(q, token, nonce(), now, timezone, { form: req.form, problems: read.problems }));
    const outcome = await answerQuote(link.orgId, link.quoteId, read.answer, { by: "customer", actor: "quote-link", now, revision: link.revision });
    if (outcome.kind === "recorded") {
      // The answer stands whatever the email does; the email log has the refusal, this line fires the alert.
      await sendQuoteAnswered(deps, link.orgId, link.quoteId, outcome.quote).catch((e: unknown) =>
        logger.error("quote page: the owner's email did not go", { orgId: link.orgId, quoteId: link.quoteId, error: e instanceof Error ? e.message : String(e) }));
    }
    return redirect(`/q/${token}`);
  }

  if (q.status === "sent") await markViewed(link.orgId, link.quoteId, q.revision, now);
  return page(200, `Quote ${label}`, quotePage(q, token, nonce(), now, timezone));
}

// ------------------------------------------------------------------ rendering

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const k = (t: number): string => formatKina(t as Toea);

const NOT_FOUND = "<h1>This link does not work</h1><p>Use the link in the most recent email about this quote.</p>";

const contact = (q: StoredQuote): string =>
  `<p>To go ahead, ask ${esc(q.snapshot.org.name)} for a new quote: reply to their email, or write to <a href="mailto:${esc(q.snapshot.org.email)}">${esc(q.snapshot.org.email)}</a>.</p>`;

function status(q: StoredQuote, now: Date, timezone: string): string {
  const label = quoteLabel(q.number, q.revision);
  if (q.acceptance !== undefined) {
    const a = q.acceptance;
    return `<p class="ok">Accepted by ${esc(a.name)} at ${esc(whenLabel(a.at.toDate(), timezone))}.</p>${a.poNumber === "" ? "" : `<p>Order number ${esc(a.poNumber)}.</p>`}<p class="m">${esc(q.snapshot.org.name)} has been told. They will be in touch about the work.</p>`;
  }
  if (q.decline !== undefined) {
    return `<p><b>Declined at ${esc(whenLabel(q.decline.at.toDate(), timezone))}.</b></p>${q.decline.reason === "" ? "" : `<p class="m">Your reason: ${esc(q.decline.reason)}</p>`}<p class="m">${esc(q.snapshot.org.name)} has been told.</p>`;
  }
  if (q.status === "expired" || quoteExpired(q, now, timezone)) {
    return `<p class="w">${esc(noAnswerReason(q, label, now, timezone) ?? "")}</p>${contact(q)}`;
  }
  return `<p>Valid until <b>${esc(dateLabel(q.validUntil))}</b>.</p>`;
}

function lines(q: StoredQuote): string {
  const rows = q.lines.map((l) => {
    const qty = l.quantityMilli === undefined || l.unitPriceToea === undefined ? "" : `${formatQuantity(l.quantityMilli)}${l.unit ? ` ${l.unit}` : ""} at ${k(l.unitPriceToea)}`;
    const under = [l.detail, qty].filter((s) => s !== "").map(esc).join(" · ");
    return `<tr><td><b>${esc(l.description)}</b>${under === "" ? "" : `<br><span class="m">${under}</span>`}</td><td class="n">${k(l.amountToea)}</td></tr>`;
  }).join("");
  const gst = q.gstToea > 0 ? `<tr><td>GST</td><td class="n">${k(q.gstToea)}</td></tr>` : "";
  return `<table><tbody>${rows}<tr><td>Subtotal</td><td class="n">${k(q.subtotalToea)}</td></tr>${gst}<tr class="tot"><td><b>Total</b></td><td class="n"><b>${k(q.totalToea)}</b></td></tr></tbody></table>`;
}

function answerForms(q: StoredQuote, token: string, nonce: string, typed?: Typed): string {
  const mine = (answer: string) => typed !== undefined && typed.form["answer"] === answer;
  const value = (answer: string, field: string) => (mine(answer) ? esc(typed?.form[field] ?? "") : "");
  const problem = (field: QuoteAnswerField) => {
    const p = typed?.problems[field];
    return p === undefined ? "" : `<span class="p">${esc(p)}</span>`;
  };
  const hidden = (answer: string) => `<input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="answer" value="${answer}">`;
  const label = quoteLabel(q.number, q.revision);
  return `${typed === undefined ? "" : '<p class="w" role="alert">Something needs fixing. Nothing was recorded.</p>'}
<h2>Accept</h2><form class="f" method="post" action="/q/${esc(token)}">${hidden("accept")}
<label>Your name <input name="name" maxlength="100" autocomplete="name" value="${value("accept", "name")}"></label>${problem("name")}
<label>Your order number (optional) <input name="poNumber" maxlength="40" value="${value("accept", "poNumber")}"></label>${problem("poNumber")}
<label class="c"><input type="checkbox" name="agree"${mine("accept") && typed?.form["agree"] !== undefined ? " checked" : ""}> I accept these terms</label>${problem("agree")}
<button>Accept quote ${esc(label)}</button></form>
<h2>Decline</h2><form class="f" method="post" action="/q/${esc(token)}">${hidden("decline")}
<label>Why not? (optional) <textarea name="reason" maxlength="500" rows="3">${value("decline", "reason")}</textarea></label>${problem("reason")}
<button class="q">Decline</button></form>`;
}

function quotePage(q: StoredQuote, token: string, nonce: string, now: Date, timezone: string, typed?: Typed): string {
  const org = q.snapshot.org;
  const open = quoteAllows(q, now, timezone).answer && q.acceptance === undefined && q.decline === undefined;
  return `<p class="m">${esc(org.name)}</p><h1>Quote ${esc(quoteLabel(q.number, q.revision))}</h1>
<p class="m">For ${esc(q.customerName)} · ${esc(dateLabel(q.issueDate))}</p>${status(q, now, timezone)}${lines(q)}
${q.snapshot.notes ? `<p class="t">${esc(q.snapshot.notes)}</p>` : ""}${q.terms === "" ? "" : `<h2>Terms</h2><p class="t m">${esc(q.terms)}</p>`}
<p><a href="/q/${esc(token)}/pdf">Download the PDF</a></p>${open ? answerForms(q, token, nonce, typed) : ""}
<p class="m">Questions? Reply to ${esc(org.name)}'s email, or write to ${esc(org.email)}.</p>`;
}

const PAGE_STYLE = `${STYLE}
table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:8px 0;border-bottom:1px solid #c9d1ce;vertical-align:top}.n{text-align:right;white-space:nowrap;padding-left:12px}
.t{white-space:pre-line}.f input:not([type]),.f textarea{display:block;width:100%;min-height:44px;margin-top:4px;padding:8px 12px;font:inherit;border:1px solid #c9d1ce;border-radius:8px;box-sizing:border-box}.f button{margin-top:8px}`;
const CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(PAGE_STYLE).digest("base64")}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

const BASE = {
  "Cache-Control": "private, no-store", // the URL is a credential: no CDN, no browser cache
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
} as const;
const HTML = { ...BASE, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP } as const;

function page(status: number, heading: string, main: string): QuotePageResponse {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(heading)}</title><style>${PAGE_STYLE}</style></head><body><main>${main}</main></body></html>`;
  return { status, headers: { ...HTML }, body };
}

const redirect = (location: string): QuotePageResponse => ({ status: 303, headers: { ...HTML, Location: location }, body: "" });
