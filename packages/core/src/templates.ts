/**
 * Invoice templates (docs/PLAN-TEMPLATES.md): how an invoice looks, never what it
 * says. Three layouts written in code, an accent from a fixed palette, a built-in
 * PDF font, the letterhead mark and a footer. Which template an invoice uses is
 * resolved at approval and frozen into its snapshot, so a later edit never reaches it.
 */
import type { Problems } from "./types.js";

export type Layout = "classic" | "band" | "compact";
export type TemplateFont = "helvetica" | "times";
/** What sits in the letterhead: the uploaded logo (initials if there is none), the initials, or nothing. */
export type TemplateMark = "logo" | "monogram" | "none";

export interface InvoiceTemplate {
  readonly name: string;
  readonly layout: Layout;
  /** One of ACCENTS. */
  readonly accent: string;
  readonly font: TemplateFont;
  readonly mark: TemplateMark;
  readonly footer: string;
}

export const LAYOUTS: readonly { readonly id: Layout; readonly label: string; readonly hint: string }[] = [
  { id: "classic", label: "Classic", hint: "Your logo on the left, your details on the right. The colour is used for the initials circle." },
  { id: "band", label: "Band", hint: "A coloured band across the top with your name, and colour on the totals." },
  { id: "compact", label: "Compact", hint: "Plain and tight, for printing. The colour is used for one thin line." },
];

/** Print-safe colours, each at least 4.5:1 against white (white text on a band, coloured text on paper). firestore.rules lists the same. */
export const ACCENTS: readonly { readonly hex: string; readonly label: string }[] = [
  { hex: "#0d6b4f", label: "Forest" },
  { hex: "#00677a", label: "Lagoon" },
  { hex: "#1f4e8c", label: "Ocean" },
  { hex: "#6b3fa0", label: "Violet" },
  { hex: "#8a3b5c", label: "Plum" },
  { hex: "#a3312a", label: "Brick" },
  { hex: "#8a5300", label: "Ochre" },
  { hex: "#2f3a45", label: "Slate" },
];

export const FONTS: readonly { readonly id: TemplateFont; readonly label: string }[] = [
  { id: "helvetica", label: "Modern (Helvetica)" },
  { id: "times", label: "Traditional (Times)" },
];

export const MARKS: readonly { readonly id: TemplateMark; readonly label: string }[] = [
  { id: "logo", label: "Your logo (your initials if you have none)" },
  { id: "monogram", label: "Your initials in a circle" },
  { id: "none", label: "Nothing, just your name" },
];

/** What every invoice looked like before templates; also what a snapshot without one prints as. */
export const CLASSIC: InvoiceTemplate = { name: "Classic", layout: "classic", accent: "#0d6b4f", font: "helvetica", mark: "logo", footer: "" };

export const MAX_TEMPLATES = 10;
export const MAX_TEMPLATE_NAME = 40;
export const MAX_FOOTER = 200;

export function templateProblems(t: InvoiceTemplate): Problems<keyof InvoiceTemplate> {
  const p: Problems<keyof InvoiceTemplate> = {};
  if (t.name.trim() === "") p.name = "Give the template a name, such as Shops.";
  else if (t.name.length > MAX_TEMPLATE_NAME) p.name = `Keep the name to ${MAX_TEMPLATE_NAME} characters or fewer.`;
  if (!LAYOUTS.some((l) => l.id === t.layout)) p.layout = "Choose a layout.";
  if (!ACCENTS.some((a) => a.hex === t.accent)) p.accent = "Choose one of the colours.";
  if (!FONTS.some((f) => f.id === t.font)) p.font = "Choose a font.";
  if (!MARKS.some((m) => m.id === t.mark)) p.mark = "Choose what goes in the letterhead.";
  if (t.footer.length > MAX_FOOTER) p.footer = `Keep the note to ${MAX_FOOTER} characters or fewer.`;
  return p;
}

/** Exactly the template's own fields, so a document's extra keys never reach a snapshot. */
export const templateOf = (t: InvoiceTemplate): InvoiceTemplate =>
  ({ name: t.name, layout: t.layout, accent: t.accent, font: t.font, mark: t.mark, footer: t.footer });

/**
 * The template an invoice uses: the first of `ids` (most specific first - tenancy,
 * property, the org's default) that names a template that still exists, else Classic.
 * A deleted template falls through; it never stops an approval.
 */
export function resolveTemplate(ids: readonly (string | null | undefined)[], templates: Readonly<Record<string, InvoiceTemplate>>): InvoiceTemplate {
  for (const id of ids) {
    if (id === null || id === undefined) continue;
    const t = Object.hasOwn(templates, id) ? templates[id] : undefined;
    if (t !== undefined) return templateOf(t);
  }
  return CLASSIC;
}

/** Where an invoice's template can be set, most specific first (docs/PLAN-TEMPLATES.md §3). */
export interface TemplateLevels {
  readonly tenancy?: { readonly templateId?: string | undefined } | undefined;
  readonly property?: { readonly templateId?: string | undefined } | undefined;
  readonly org?: { readonly defaultTemplateId?: string | undefined } | undefined;
}

/** The ids to resolve, in order: the tenancy's, the property's, then the org's default. */
export const templateIds = (l: TemplateLevels): (string | undefined)[] =>
  [l.tenancy?.templateId, l.property?.templateId, l.org?.defaultTemplateId];

/** The template an invoice for this tenancy uses: tenancy → property → org default → Classic. */
export const templateFor = (l: TemplateLevels, templates: Readonly<Record<string, InvoiceTemplate>>): InvoiceTemplate =>
  resolveTemplate(templateIds(l), templates);

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Why a template cannot be deleted, or null. The UI keeps it (rules cannot query);
 * if one goes anyway, invoices fall through to the next level at approval.
 */
export function templateDeleteProblem(id: string, use: {
  readonly defaultTemplateId?: string | undefined;
  readonly properties: readonly { readonly templateId?: string | undefined }[];
  readonly tenancies: readonly { readonly templateId?: string | undefined }[];
}): string | null {
  if (use.defaultTemplateId === id) return "This is your default template, so it cannot be deleted. Make another template the default first.";
  const p = use.properties.filter((x) => x.templateId === id).length;
  const t = use.tenancies.filter((x) => x.templateId === id).length;
  if (p === 0 && t === 0) return null;
  const who = [p > 0 ? count(p, "property", "properties") : "", t > 0 ? count(t, "tenancy", "tenancies") : ""].filter((s) => s !== "").join(" and ");
  return `${who} ${p + t === 1 ? "uses" : "use"} this template. Set ${p + t === 1 ? "it" : "them"} to another template first.`;
}

/** Up to two initials from a name, for the monogram; "S" when there are none. */
export const initials = (name: string): string =>
  name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "S";
