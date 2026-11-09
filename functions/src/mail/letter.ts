/**
 * An email's content, once (docs/PLAN-TEMPLATES.md §6): a greeting and blocks, rendered
 * to the plain-text part and to the HTML part, so the two always say the same.
 * The HTML is one column of tables with inline styles, no remote images and nothing
 * that tracks; every value is escaped (tenant, property and org names are user input),
 * and every link shows its own URL.
 */
import { CLASSIC, type InvoiceTemplate, initials } from "@sasimem/core";

export type Block =
  /** A paragraph; a link goes on the line after it, as its own visible URL. */
  | { readonly p: string; readonly link?: string }
  /** A link on its own, showing its URL. */
  | { readonly link: string; readonly p?: undefined }
  /** "Label: value" lines; a table in HTML. */
  | { readonly rows: readonly (readonly [string, string])[] }
  /** One line each. */
  | { readonly lines: readonly string[] }
  /** The template's note, set apart in HTML. */
  | { readonly note: string };

export interface Letter {
  readonly greeting: string;
  readonly blocks: readonly Block[];
}

export function letterText(l: Letter): string {
  return [l.greeting, ...l.blocks.map((b) => {
    if ("rows" in b) return b.rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    if ("lines" in b) return b.lines.join("\n");
    if ("note" in b) return b.note;
    if (b.p === undefined) return b.link;
    return b.link === undefined ? b.p : `${b.p}\n${b.link}`;
  })].join("\n\n");
}

/** How the HTML looks: the invoice's frozen template for tenants, the house style for landlords. */
export interface Brand {
  readonly name: string;
  readonly accent: string;
  readonly font: InvoiceTemplate["font"];
  readonly mark: { readonly kind: "logo"; readonly cid: string; readonly width: number; readonly height: number } | { readonly kind: "monogram" } | { readonly kind: "none" };
}

/** Landlord emails: Sasimem's own plain style. */
export const HOUSE: Brand = { name: "Sasimem", accent: CLASSIC.accent, font: "helvetica", mark: { kind: "none" } };

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const INK = "#1c2321";
const MUTED = "#5b6662";
const FAMILY = { helvetica: "Helvetica,Arial,sans-serif", times: "Georgia,'Times New Roman',Times,serif" } as const;

function markHtml(b: Brand): string {
  if (b.mark.kind === "logo") {
    return `<td style="padding:0 16px 0 0" valign="middle"><img src="cid:${esc(b.mark.cid)}" width="${b.mark.width}" height="${b.mark.height}" alt="${esc(b.name)}" style="display:block;border:0;outline:none"></td>`;
  }
  if (b.mark.kind === "monogram") {
    return `<td style="padding:0 16px 0 0" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="48" height="48" align="center" valign="middle" style="width:48px;height:48px;border-radius:24px;background:${b.accent};color:#ffffff;font-weight:bold;font-size:18px">${esc(initials(b.name))}</td></tr></table></td>`;
  }
  return "";
}

function blockHtml(block: Block, accent: string): string {
  const para = "margin:0 0 16px";
  if ("rows" in block) {
    const rows = block.rows.map(([k, v]) => `<tr><td width="140" style="width:140px;padding:2px 16px 2px 0;color:${MUTED};vertical-align:top">${esc(k)}</td><td style="padding:2px 0;font-weight:bold;vertical-align:top">${esc(v)}</td></tr>`).join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="${para};border-collapse:collapse">${rows}</table>`;
  }
  if ("lines" in block) return `<p style="${para}">${block.lines.map(esc).join("<br>")}</p>`;
  if ("note" in block) return `<p style="${para};padding:8px 12px;border-left:3px solid ${accent};color:${MUTED}">${esc(block.note).replace(/\r?\n/g, "<br>")}</p>`;
  const link = block.link === undefined ? "" : `<a href="${esc(block.link)}" style="color:${accent};word-break:break-all">${esc(block.link)}</a>`;
  if (block.p === undefined) return `<p style="${para}">${link}</p>`;
  return `<p style="${para}">${esc(block.p)}${link === "" ? "" : `<br>${link}`}</p>`;
}

export function letterHtml(l: Letter, brand: Brand, subject: string): string {
  const family = FAMILY[brand.font];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f4"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:6px solid ${brand.accent};border-radius:6px">
<tr><td style="padding:24px 24px 8px;font-family:${family}"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${markHtml(brand)}<td valign="middle" style="font-size:20px;font-weight:bold;color:${brand.accent}">${esc(brand.name)}</td></tr></table></td></tr>
<tr><td style="padding:16px 24px 8px;font-family:${family};font-size:16px;line-height:1.5;color:${INK}">
<p style="margin:0 0 16px">${esc(l.greeting)}</p>
${l.blocks.map((b) => blockHtml(b, brand.accent)).join("\n")}
</td></tr></table></td></tr></table></body></html>`;
}
