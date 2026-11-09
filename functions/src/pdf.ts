/**
 * The invoice PDF (plan §6.5): one A4 page, built-in PDF fonts only (no embedded
 * fonts), rendered only from the invoice's frozen snapshot. Pure and deterministic:
 * the same invoice and logo always give the same bytes.
 * Budget ≤ 150 KB with a logo, so logos are downscaled to ≤ 400 px here.
 *
 * Three layouts (docs/PLAN-TEMPLATES.md §4) print the same content - title, number,
 * dates, GST number, bill-to, lines, totals, bank and reference - and differ only in
 * arrangement. Classic is exactly the layout from before templates: a snapshot with
 * no template, or the default Classic one, renders to the same bytes as it always did.
 */
import { CLASSIC, type CalendarDate, type InvoiceDocument, type InvoiceSnapshot, type InvoiceTemplate, type Toea, dateLabel, formatKina, initials } from "@sasimem/core";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { fitInside } from "./png.js";

const INK = "#1c2321";
const MUTED = "#5b6662";
const LINE = "#c9d1ce";
const WHITE = "#ffffff";
const MAX_LOGO_PX = 400;

/** Any image the landlord uploaded, as a PNG of at most 400 px: PDFKit embeds only PNG and JPEG. */
export async function prepareLogo(logo: Buffer): Promise<Buffer> {
  return sharp(logo).resize(MAX_LOGO_PX, MAX_LOGO_PX, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
}

type Doc = PDFKit.PDFDocument;
interface Fonts { readonly regular: string; readonly bold: string }

/** Everything a layout draws from. */
interface Page {
  readonly doc: Doc;
  readonly invoice: InvoiceDocument;
  readonly org: InvoiceSnapshot["org"];
  readonly snap: InvoiceSnapshot;
  readonly t: InvoiceTemplate;
  readonly f: Fonts;
  /** The prepared logo, or null when the template shows initials or nothing. */
  readonly logo: Buffer | null;
  readonly showGst: boolean;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

const k = (t: number) => formatKina(t as Toea);
const date = (d: string) => dateLabel(d as CalendarDate);

export async function renderInvoicePdf(invoice: InvoiceDocument, logo: Buffer | null, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const snap = invoice.snapshot;
  if (snap === null || invoice.number === null) throw new Error(`invoice ${invoice.tenancyId}_${invoice.period} is not approved`);
  const org = snap.org;
  const t = snap.template ?? CLASSIC;

  const doc = new PDFDocument({ size: "A4", margin: 50, compress: opts.compress ?? true, info: {
    Title: `${invoice.documentTitle} ${invoice.number}`, Author: org.name,
    // Fixed, so the same invoice always renders to the same bytes (see store/pdfs.ts).
    CreationDate: new Date(`${invoice.issueDate}T00:00:00Z`),
  } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const page: Page = {
    doc, invoice, org, snap, t,
    f: t.font === "times" ? { regular: "Times-Roman", bold: "Times-Bold" } : { regular: "Helvetica", bold: "Helvetica-Bold" },
    logo: t.mark === "logo" && logo !== null ? await prepareLogo(logo) : null,
    showGst: invoice.lines.some((l) => l.gstApplicable),
    left: 50, right: doc.page.width - 50, width: doc.page.width - 100,
  };
  if (t.layout === "band") band(page);
  else if (t.layout === "compact") compact(page);
  else classic(page);

  doc.end();
  return done;
}

/** The letterhead mark's kind for this page: a logo, the initials, or nothing. */
const markOf = (p: Page): "logo" | "monogram" | "none" => (p.logo !== null ? "logo" : p.t.mark === "none" ? "none" : "monogram");

function facts(p: Page): [string, string][] {
  const { invoice, org } = p;
  return [
    ["Number", invoice.number ?? ""],
    ["Issued", date(invoice.issueDate)],
    ["Due", date(invoice.dueDate)],
    ...(p.showGst && org.gstRegistered && org.gstNumber !== "" ? [["GST number", org.gstNumber] as [string, string]] : []),
  ];
}

// ---- Classic: the layout from before templates. Every call here is as it was, so its bytes are too.

function classic(p: Page): void {
  const { doc, org, f, left, width } = p;
  // Letterhead: the logo, or a monogram of the org's initials.
  const mark = markOf(p);
  if (mark === "logo" && p.logo !== null) {
    doc.image(p.logo, left, 50, { fit: [160, 60] });
  } else if (mark === "monogram") {
    doc.circle(left + 24, 74, 24).fill(p.t.accent);
    doc.fillColor(WHITE).font(f.bold).fontSize(16).text(initials(org.name), left, 66, { width: 48, align: "center" });
  }
  doc.fillColor(INK).font(f.bold).fontSize(14).text(org.name, left + 200, 50, { width: width - 200, align: "right" });
  doc.font(f.regular).fontSize(9).fillColor(MUTED);
  for (const line of [org.address, org.email].filter((x) => x !== "")) doc.text(line, { width: width - 200, align: "right" });

  titleFactsBillTo(p, { title: INK });
  const top = Math.max(172 + facts(p).length * 15, doc.y) + 30;
  const s = fitting(p, top);
  payment(p, totals(p, table(p, top, s), s, null), s, null);
}

/** Title, number, dates, GST number, and bill-to (Classic and Band). */
function titleFactsBillTo(p: Page, colours: { title: string }): void {
  const { doc, invoice, snap, f, left, width } = p;
  doc.fillColor(colours.title).font(f.bold).fontSize(20).text(invoice.documentTitle, left, 140);
  doc.font(f.regular).fontSize(10);
  let y = 172;
  for (const [label, value] of facts(p)) {
    doc.fillColor(MUTED).text(label, left, y, { width: 90 });
    doc.fillColor(INK).text(value, left + 90, y);
    y += 15;
  }
  doc.fillColor(MUTED).text("Bill to", left + 300, 172);
  doc.fillColor(INK).font(f.bold).text(snap.tenantName, left + 300, 187);
  doc.font(f.regular).text(`${snap.unitLabel}, ${snap.propertyAddress}`, left + 300, doc.y, { width: width - 300 });
}

/** Type sizes and spacing for the table, totals and payment block. */
interface Scale {
  readonly head: number; readonly body: number; readonly detail: number;
  readonly row: number; readonly detailRow: number; readonly gap: number;
  readonly totalRow: number; readonly total: number; readonly afterTotals: number;
  readonly payRow: number; readonly reference: number;
}
const ROOMY: Scale = { head: 9, body: 10, detail: 9, row: 14, detailRow: 13, gap: 4, totalRow: 16, total: 12, afterTotals: 40, payRow: 15, reference: 22 };
/** Classic and Band when ROOMY would not fit one page (many charges, a long note). */
const SNUG: Scale = { head: 9, body: 10, detail: 8, row: 12, detailRow: 10, gap: 2, totalRow: 14, total: 12, afterTotals: 28, payRow: 13, reference: 18 };
const TIGHT: Scale = { head: 8, body: 9, detail: 8, row: 12, detailRow: 11, gap: 3, totalRow: 14, total: 11, afterTotals: 30, payRow: 13, reference: 16 };

/**
 * ROOMY if the table, totals and payment fit below `top`, else SNUG. An estimate (a
 * description that wraps adds a line); measuring the note only when there is one
 * keeps an invoice without one byte-identical to before templates.
 */
function fitting(p: Page, top: number): Scale {
  const s = ROOMY;
  const lines = p.invoice.lines.reduce((h, l) => h + s.row + (l.detail === "" ? 0 : s.detailRow) + s.gap, 0);
  const totalsHeight = (p.showGst ? 2 : 1) * s.totalRow + s.afterTotals;
  let note = 0;
  if (p.t.footer !== "") {
    const { gstX } = columns(p);
    p.doc.font(p.f.regular).fontSize(s.detail);
    note = Math.max(0, p.doc.heightOfString(p.t.footer, { width: gstX - 60 - p.left - 20 }) + 16 - totalsHeight);
  }
  const pay = s.body * 2 + s.payRow * 3 + 8 + 14 + s.reference * 1.2;
  return top + s.row + 8 + lines + 10 + totalsHeight + note + pay <= p.doc.page.maxY() ? ROOMY : SNUG;
}

const columns = (p: Page) => {
  const amountX = p.right - 100;
  return { amountX, gstX: amountX - 90 };
};

/** The lines, each with a GST column only when any line is taxable. Returns the y below the closing rule. */
function table(p: Page, top: number, s: Scale, headColour: string = MUTED): number {
  const { doc, invoice, left, right, showGst } = p;
  const { amountX, gstX } = columns(p);
  let y = top;
  doc.fillColor(headColour).fontSize(s.head).text("Description", left, y);
  if (showGst) doc.text("GST", gstX, y, { width: 80, align: "right" });
  doc.text("Amount", amountX, y, { width: 100, align: "right" });
  y += s.row;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
  y += 8;
  doc.fontSize(s.body);
  for (const l of invoice.lines) {
    doc.fillColor(INK).text(l.description, left, y, { width: gstX - left - 10 });
    const below = doc.y; // a description that wraps pushes the rest down
    if (showGst) doc.text(l.gstApplicable ? k(l.gstToea) : "-", gstX, y, { width: 80, align: "right" });
    doc.text(k(l.amountToea), amountX, y, { width: 100, align: "right" });
    y = Math.max(y + s.row, below + 2);
    if (l.detail !== "") {
      doc.fillColor(MUTED).fontSize(s.detail).text(l.detail, left, y);
      doc.fontSize(s.body);
      y += s.detailRow;
    }
    y += s.gap;
  }
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
  return y + 10;
}

/**
 * Subtotal, GST and total, always recomputed upstream from the lines (plan §3.4) and
 * printed as stored; the template's note sits beside them. Returns where payment starts.
 */
function totals(p: Page, top: number, s: Scale, totalColour: string | null): number {
  const { doc, invoice, f, left, showGst, t } = p;
  const { amountX, gstX } = columns(p);
  let y = top;
  const rows: [string, number][] = [["Subtotal", invoice.subtotalToea], ...(showGst ? [["GST", invoice.gstToea] as [string, number]] : [])];
  for (const [label, amount] of rows) {
    doc.fillColor(MUTED).text(label, gstX - 60, y, { width: 140, align: "right" });
    doc.fillColor(INK).text(k(amount), amountX, y, { width: 100, align: "right" });
    y += s.totalRow;
  }
  if (totalColour !== null) doc.fillColor(totalColour);
  doc.font(f.bold).fontSize(s.total).text("Total", gstX - 60, y, { width: 140, align: "right" });
  doc.text(k(invoice.totalToea), amountX, y, { width: 100, align: "right" });
  y += s.afterTotals;
  if (t.footer === "") return y;
  // The note, to the left of the totals; payment waits below it if it runs long.
  doc.font(f.regular).fontSize(s.detail).fillColor(MUTED).text(t.footer, left, top, { width: gstX - 60 - left - 20 });
  return Math.max(y, doc.y + 16);
}

/** How to pay, with the reference in large type: it is what matches the deposit. */
function payment(p: Page, top: number, s: Scale, boxColour: string | null): void {
  const { doc, invoice, org, f, left } = p;
  let y = top;
  doc.font(f.regular).fontSize(s.body).fillColor(MUTED).text("Pay by bank deposit", left, y);
  y += s.payRow;
  doc.fillColor(INK);
  for (const [label, value] of [["Bank", org.bankName], ["Account", org.bankAccount]] as const) {
    if (value === "") continue;
    doc.fillColor(MUTED).text(label, left, y, { width: 90 });
    doc.fillColor(INK).text(value, left + 90, y);
    y += s.payRow;
  }
  y += 8;
  doc.fillColor(MUTED).text("Write this reference on your deposit", left, y);
  doc.fillColor(INK).font(f.bold).fontSize(s.reference).text(invoice.paymentReference, left, y + 14);
  if (boxColour !== null) {
    const w = doc.widthOfString(invoice.paymentReference);
    doc.roundedRect(left - 6, y + 12, w + 12, s.reference + 8, 4).lineWidth(1.5).strokeColor(boxColour).stroke();
  }
}

// ---- Band: a coloured band across the top with the name in white; colour on the totals.

function band(p: Page): void {
  const { doc, org, f, left, width, t } = p;
  doc.rect(0, 0, doc.page.width, 120).fill(t.accent);
  const mark = markOf(p);
  if (mark === "logo" && p.logo !== null) {
    // A white plate just round the logo as it fits 160 × 56, so a square logo has no blank beside it.
    const { w, h } = fitInside(p.logo, 160, 56);
    doc.roundedRect(left, 60 - h / 2 - 6, w + 12, h + 12, 6).fill(WHITE);
    doc.image(p.logo, left + 6, 60 - h / 2, { width: w, height: h });
  } else if (mark === "monogram") {
    doc.circle(left + 28, 60, 28).fill(WHITE);
    doc.fillColor(t.accent).font(f.bold).fontSize(18).text(initials(org.name), left, 51, { width: 56, align: "center" });
  }
  doc.fillColor(WHITE).font(f.bold).fontSize(16).text(org.name, left + 200, 36, { width: width - 200, align: "right" });
  doc.font(f.regular).fontSize(9);
  for (const line of [org.address, org.email].filter((x) => x !== "")) doc.text(line, { width: width - 200, align: "right" });

  titleFactsBillTo(p, { title: t.accent });
  const top = Math.max(172 + facts(p).length * 15, doc.y) + 30;
  const s = fitting(p, top);
  payment(p, totals(p, table(p, top, s, t.accent), s, t.accent), s, t.accent);
}

// ---- Compact: plain and tight, for printing; the colour is one thin rule.

function compact(p: Page): void {
  const { doc, org, snap, invoice, f, left, right, width, t } = p;
  const mark = markOf(p);
  let nameX = left;
  if (mark === "logo" && p.logo !== null) {
    doc.image(p.logo, left, 50, { fit: [120, 40] });
    nameX = left + 132;
  } else if (mark === "monogram") {
    doc.circle(left + 18, 68, 18).fill(t.accent);
    doc.fillColor(WHITE).font(f.bold).fontSize(12).text(initials(org.name), left, 62, { width: 36, align: "center" });
    nameX = left + 48;
  }
  const nameWidth = left + 290 - nameX; // clear of the title on the right
  doc.fillColor(INK).font(f.bold).fontSize(12).text(org.name, nameX, 52, { width: nameWidth });
  doc.font(f.regular).fontSize(8).fillColor(MUTED).text([org.address, org.email].filter((x) => x !== "").join("  ·  "), nameX, doc.y + 1, { width: nameWidth });
  doc.fillColor(INK).font(f.bold).fontSize(14).text(invoice.documentTitle, left + 300, 52, { width: width - 300, align: "right" });

  doc.moveTo(left, 100).lineTo(right, 100).lineWidth(1.5).strokeColor(t.accent).stroke();
  doc.lineWidth(1);

  // The facts in one row, label over value.
  facts(p).forEach(([label, value], i) => {
    const x = left + i * 124;
    doc.font(f.regular).fontSize(8).fillColor(MUTED).text(label, x, 110, { width: 118 });
    doc.fontSize(9).fillColor(INK).text(value, x, 121, { width: 118 });
  });
  doc.fontSize(8).fillColor(MUTED).text("Bill to", left, 146);
  doc.font(f.bold).fontSize(9).fillColor(INK).text(snap.tenantName, left, 157);
  doc.font(f.regular).text(`${snap.unitLabel}, ${snap.propertyAddress}`, left, doc.y, { width });

  const y = table(p, doc.y + 18, TIGHT);
  payment(p, totals(p, y, TIGHT, null), TIGHT, null);
}
