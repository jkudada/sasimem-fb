/**
 * The approval page (plan §6.1): GET /a/{token}, POST /a/{token}, POST /a/{token}/fresh.
 * One server-rendered HTML page, inline CSS, no required JavaScript, ≤ 30 KB.
 * Nothing here can send: it can only move a run to approved; the tick releases it.
 *
 * handleApproval is a plain request → response function so T3 can call it; the
 * onRequest wrapper in index.ts adapts it to Express.
 */
import { createHash } from "node:crypto";
import {
  type InvoiceDocument, type Period, type RunStatus, type Toea,
  formatKina, isEditable, periodLabel, readApprovalForm,
} from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { type RunDeps, sendFreshLink } from "../callables/runs.js";
import { checkNonce, makeNonce } from "../links.js";
import { whenLabel } from "../mail/templates.js";
import { approveRun } from "../store/approval.js";
import { renderMissingPdfs } from "../store/pdfs.js";
import { db } from "../admin.js";
import { type OrgDoc, refs } from "../store/runs.js";
import { lookupToken, replaceToken } from "../store/tokens.js";

export interface PageDeps extends RunDeps {
  readonly signingKey: () => string;
}

export interface PageRequest {
  readonly method: string;
  readonly path: string;
  readonly form: Readonly<Record<string, string | undefined>>;
}

export interface PageResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

// ------------------------------------------------------------------ routing

export async function handleApproval(req: PageRequest, deps: PageDeps): Promise<PageResponse> {
  const match = /\/a\/([^/]+)(\/fresh)?\/?$/.exec(req.path);
  if (match === null) return page(404, "Not found", NOT_FOUND);
  const token = match[1] ?? "";
  const now = deps.now();
  const found = await lookupToken(token, now);
  if (found.state === "unknown") return page(404, "Link not recognised", NOT_FOUND);

  const nonceOk = () => checkNonce(deps.signingKey(), token, req.form["nonce"] ?? "", now);

  if (match[2] !== undefined) {
    if (req.method !== "POST") return redirect(`/a/${token}`);
    if (!nonceOk()) return page(400, "Please try again", staleForm(token));
    return freshLinkRequested(found.orgId, found.period, now, deps);
  }

  if (found.state === "dead") return page(410, "This link no longer works", deadLink(token, makeNonce(deps.signingKey(), token, now)));
  const view = await loadView(found.orgId, found.period);
  if (req.method === "POST") {
    if (!nonceOk()) return page(400, "Please try again", staleForm(token));
    if (!isEditable(view.status)) return redirect(`/a/${token}`);
    const read = readApprovalForm(req.form, view.editable.map((i) => i.id));
    if (!read.ok) return page(422, title(view), runPage(view, token, makeNonce(deps.signingKey(), token, now), { typed: req.form, problems: read.problems }));
    await approveRun(found.orgId, found.period, { actor: "approval-link", now, edits: read });
    await renderMissingPdfs(found.orgId, found.period);
    return redirect(`/a/${token}`);
  }
  return page(200, title(view), runPage(view, token, makeNonce(deps.signingKey(), token, now)));
}

// ------------------------------------------------------------------ data

interface View {
  readonly org: OrgDoc;
  readonly period: Period;
  readonly status: RunStatus;
  readonly sendAt: Date;
  readonly invoices: readonly (InvoiceDocument & { readonly id: string })[];
  readonly editable: readonly (InvoiceDocument & { readonly id: string })[];
}

async function loadView(orgId: string, period: Period): Promise<View> {
  const r = refs(orgId);
  const [org, run, invoices] = await Promise.all([r.org.get(), r.run(period).get(), r.invoicesOf(period).get()]);
  const all = invoices.docs
    .map((d) => ({ ...(d.data() as InvoiceDocument), id: d.id }))
    .sort((a, b) => (a.tenantName < b.tenantName ? -1 : a.tenantName > b.tenantName ? 1 : 0));
  return {
    org: org.data() as OrgDoc,
    period,
    status: run.get("status") as RunStatus,
    sendAt: (run.get("sendAt") as Timestamp).toDate(),
    invoices: all,
    editable: all.filter((i) => i.status === "draft" || i.status === "excluded"),
  };
}

const FRESH_LINK_GAP_MS = 10 * 60_000;

/** At most one fresh link per run each 10 minutes, so an old link cannot flood the landlord's inbox. */
async function freshLinkRequested(orgId: string, period: Period, now: Date, deps: PageDeps): Promise<PageResponse> {
  const r = refs(orgId);
  const org = (await r.org.get()).data() as OrgDoc;
  const claimed = await db().runTransaction(async (tx) => {
    const run = await tx.get(r.run(period));
    const last = run.get("freshLinkSentAt") as Timestamp | null | undefined;
    if (last != null && now.getTime() - last.toMillis() < FRESH_LINK_GAP_MS) return false;
    tx.update(r.run(period), { freshLinkSentAt: Timestamp.fromDate(now) });
    return true;
  });
  if (claimed) {
    const token = deps.newToken();
    if (await replaceToken(orgId, period, now, token)) await sendFreshLink(deps, orgId, org, period, token);
    else return page(200, "Nothing to approve", `<h1>Nothing to approve</h1><p>${esc(periodLabel(period))} is no longer waiting for approval.</p>`);
  }
  return page(200, "A new link is on its way", `<h1>Check your email</h1><p>A new link is on its way to ${esc(mask(org.email))}. It replaces every earlier link.</p>`);
}

// ------------------------------------------------------------------ rendering

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const k = (t: number): string => formatKina(t as Toea);
const mask = (email: string): string => email.replace(/^(.)[^@]*@/, "$1•••@");
const title = (v: View): string => `${v.org.name}: ${periodLabel(v.period)} invoices`;

const NOT_FOUND = "<h1>This link does not work</h1><p>Use the most recent link in your email, or sign in to Sasimem.</p>";
const staleForm = (token: string) =>
  `<h1>Please try again</h1><p>This page was open too long, or was changed. <a href="/a/${esc(token)}">Reload it</a> and try again. Nothing was approved.</p>`;

function deadLink(token: string, nonce: string): string {
  return `<h1>This link no longer works</h1><p>Approval links last 7 days, and each new link replaces the earlier ones.</p>
<form method="post" action="/a/${esc(token)}/fresh"><input type="hidden" name="nonce" value="${esc(nonce)}"><button>Email me a new link</button></form>
<p class="m">It goes to the email address on your account.</p>`;
}

function runPage(v: View, token: string, nonce: string, again?: { typed: PageRequest["form"]; problems: Readonly<Record<string, string>> }): string {
  const when = whenLabel(v.sendAt, v.org.timezone);
  const head = `<h1>${esc(periodLabel(v.period))} invoices</h1><p class="m">${esc(v.org.name)}</p>`;
  if (v.status === "approved") return `${head}<p class="ok">Approved - goes out at ${esc(when)}.</p>${numberedList(v)}`;
  if (v.status === "sent") return `${head}<p class="ok">Sent to your tenants.</p>${numberedList(v)}`;
  if (v.status === "cancelled") return `${head}<p>This month's invoices were cancelled.</p>`;

  const lead = v.status === "held"
    ? `<p class="w">These were held at ${esc(when)} because they had not been approved. This will go out within the hour once you approve.</p>`
    : `<p>Check each rent, untick anyone not to invoice this month, then approve. Nothing is sent before ${esc(when)}.</p>`;
  const rows = v.editable.map((inv) => row(inv, again)).join("");
  const included = v.editable.filter((i) => i.status === "draft");
  const total = included.reduce((s, i) => s + i.totalToea, 0);
  const n = included.length;
  return `${head}${lead}${again === undefined ? "" : '<p class="w" role="alert">Some amounts need fixing. Nothing was approved.</p>'}
<form method="post" action="/a/${esc(token)}"><input type="hidden" name="nonce" value="${esc(nonce)}">${rows}
<p class="tot">Total <b id="tot">${k(total)}</b></p>
<button>Approve ${n} ${n === 1 ? "invoice" : "invoices"}</button></form>
<p class="m">Approving gives each invoice its number and fixes it. Unticked tenants are not invoiced this month.</p>`;
}

function row(inv: InvoiceDocument & { id: string }, again?: { typed: PageRequest["form"]; problems: Readonly<Record<string, string>> }): string {
  const rent = inv.lines.find((l) => l.kind === "rent");
  const extras = inv.lines.filter((l) => l.kind !== "rent");
  const other = extras.reduce((s, l) => s + l.amountToea + l.gstToea, 0);
  const typed = again?.typed[`rent.${inv.id}`];
  const ticked = again === undefined ? inv.status === "draft" : again.typed[`include.${inv.id}`] !== undefined;
  const problem = again?.problems[inv.id];
  // data-g: rent attracts GST; data-o: other charges with their GST. Only the optional script reads them.
  return `<div class="r"><p><b>${esc(inv.tenantName)}</b> · ${esc(inv.unitLabel)} · <span class="m">${esc(inv.paymentReference)}</span></p>
<label>Rent<span class="sr"> for ${esc(inv.tenantName)}</span> <input name="rent.${esc(inv.id)}" value="${esc(typed ?? k(rent?.amountToea ?? 0))}" inputmode="decimal" data-g="${rent?.gstApplicable === true ? 1 : 0}" data-o="${other}"></label>${problem === undefined ? "" : `<span class="p">${esc(problem)}</span>`}
<label class="c"><input type="checkbox" name="include.${esc(inv.id)}"${ticked ? " checked" : ""}> Invoice<span class="sr"> ${esc(inv.tenantName)}</span> this month</label>${extras.length > 0 ? `<p class="m">Plus ${k(other)} in other charges${inv.gstToea > 0 ? ", GST included" : ""}.</p>` : ""}</div>`;
}

function numberedList(v: View): string {
  const items = v.invoices.filter((i) => i.number !== null).map((i) => `<li>${esc(i.number ?? "")} · ${esc(i.tenantName)} · ${k(i.totalToea)}</li>`).join("");
  return items === "" ? "" : `<ul>${items}</ul>`;
}

// The page's only style and its optional script, allowed by hash in the CSP (no 'unsafe-inline').
const STYLE = `body{font:16px/1.45 system-ui,sans-serif;color:#1c2321;background:#fbfbf9;margin:0}main{max-width:32rem;margin:0 auto;padding:16px}
h1{font-size:1.4rem;margin:.5rem 0}.m{color:#5b6662;font-size:.9rem}.r{border-bottom:1px solid #c9d1ce;padding:12px 0}.r p{margin:0 0 8px}
label{display:block;margin:6px 0}input[inputmode]{display:block;width:100%;min-height:44px;padding:8px 12px;font:inherit;border:1px solid #c9d1ce;border-radius:8px;box-sizing:border-box}
.c{display:flex;gap:12px;align-items:center;min-height:44px}.c input{width:22px;height:22px}.p,.w{color:#a3261b}.ok{color:#0d6b4f;font-weight:600}
.tot{font-size:1.2rem;text-align:right}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}button{width:100%;min-height:48px;font:inherit;font-weight:600;border:0;border-radius:8px;background:#0d6b4f;color:#fff}`;
const SCRIPT = `(function(){var f=document.forms[0];if(!f)return;function t(s){s=s.replace(/[K,\\s]/g,"");return /^\\d*\\.?\\d*$/.test(s)&&s!==""?Math.round(parseFloat(s)*100):NaN}
function u(){var n=0,ok=true;f.querySelectorAll("[data-g]").forEach(function(i){var c=i.closest(".r").querySelector("[type=checkbox]");if(!c.checked)return;var r=t(i.value);if(isNaN(r)){ok=false;return}
n+=r+(i.dataset.g==="1"?Math.floor((r*10+50)/100):0)+Number(i.dataset.o)});var e=document.getElementById("tot");e.textContent=ok?"K"+(n/100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g,","):"-"}
f.addEventListener("input",u);f.addEventListener("change",u)})();`;
const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
const CSP = `default-src 'none'; style-src ${hash(STYLE)}; script-src ${hash(SCRIPT)}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store", // the URL is a credential: no CDN, no browser cache
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
} as const;

function page(status: number, heading: string, main: string): PageResponse {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(heading)}</title><style>${STYLE}</style></head><body><main>${main}</main><script>${SCRIPT}</script></body></html>`;
  return { status, headers: { ...HEADERS }, body };
}

const redirect = (location: string): PageResponse => ({ status: 303, headers: { ...HEADERS, Location: location }, body: "" });
