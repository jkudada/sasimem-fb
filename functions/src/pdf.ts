/**
 * The invoice PDF (plan §6.5): one A4 page, PDFKit's built-in Helvetica (no embedded
 * fonts), rendered only from the invoice's frozen snapshot. Pure and deterministic:
 * the same invoice and logo always give the same bytes.
 * Budget ≤ 150 KB with a logo, so logos are downscaled to ≤ 400 px here.
 */
import { type CalendarDate, type InvoiceDocument, type Toea, dateLabel, formatKina } from "@sasimem/core";
import PDFDocument from "pdfkit";
import sharp from "sharp";

const INK = "#1c2321";
const MUTED = "#5b6662";
const ACCENT = "#0d6b4f";
const LINE = "#c9d1ce";
const MAX_LOGO_PX = 400;

/** Any image the landlord uploaded, as a PNG of at most 400 px: PDFKit embeds only PNG and JPEG. */
export async function prepareLogo(logo: Buffer): Promise<Buffer> {
  return sharp(logo).resize(MAX_LOGO_PX, MAX_LOGO_PX, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
}

const initials = (name: string): string =>
  name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "S";

export async function renderInvoicePdf(invoice: InvoiceDocument, logo: Buffer | null, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const snap = invoice.snapshot;
  if (snap === null || invoice.number === null) throw new Error(`invoice ${invoice.tenancyId}_${invoice.period} is not approved`);
  const org = snap.org;
  const showGst = invoice.lines.some((l) => l.gstApplicable);
  const k = (t: number) => formatKina(t as Toea);
  const date = (d: string) => dateLabel(d as CalendarDate);

  const doc = new PDFDocument({ size: "A4", margin: 50, compress: opts.compress ?? true, info: {
    Title: `${invoice.documentTitle} ${invoice.number}`, Author: org.name,
    // Fixed, so the same invoice always renders to the same bytes (see store/pdfs.ts).
    CreationDate: new Date(`${invoice.issueDate}T00:00:00Z`),
  } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const left = 50;
  const right = doc.page.width - 50;
  const width = right - left;

  // Letterhead: the logo, or a monogram of the org's initials.
  if (logo !== null) {
    doc.image(await prepareLogo(logo), left, 50, { fit: [160, 60] });
  } else {
    doc.circle(left + 24, 74, 24).fill(ACCENT);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text(initials(org.name), left, 66, { width: 48, align: "center" });
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(org.name, left + 200, 50, { width: width - 200, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  for (const line of [org.address, org.email].filter((x) => x !== "")) doc.text(line, { width: width - 200, align: "right" });

  // Title, number, dates, GST number.
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(invoice.documentTitle, left, 140);
  doc.font("Helvetica").fontSize(10);
  const facts: [string, string][] = [
    ["Number", invoice.number],
    ["Issued", date(invoice.issueDate)],
    ["Due", date(invoice.dueDate)],
    ...(showGst && org.gstRegistered && org.gstNumber !== "" ? [["GST number", org.gstNumber] as [string, string]] : []),
  ];
  let y = 172;
  for (const [label, value] of facts) {
    doc.fillColor(MUTED).text(label, left, y, { width: 90 });
    doc.fillColor(INK).text(value, left + 90, y);
    y += 15;
  }

  // Bill to.
  doc.fillColor(MUTED).text("Bill to", left + 300, 172);
  doc.fillColor(INK).font("Helvetica-Bold").text(snap.tenantName, left + 300, 187);
  doc.font("Helvetica").text(`${snap.unitLabel}, ${snap.propertyAddress}`, left + 300, doc.y, { width: width - 300 });

  // Lines.
  y = Math.max(y, doc.y) + 30;
  const amountX = right - 100;
  const gstX = amountX - 90;
  doc.fillColor(MUTED).fontSize(9).text("Description", left, y);
  if (showGst) doc.text("GST", gstX, y, { width: 80, align: "right" });
  doc.text("Amount", amountX, y, { width: 100, align: "right" });
  y += 14;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
  y += 8;
  doc.fontSize(10);
  for (const l of invoice.lines) {
    doc.fillColor(INK).text(l.description, left, y, { width: gstX - left - 10 });
    if (showGst) doc.text(l.gstApplicable ? k(l.gstToea) : "-", gstX, y, { width: 80, align: "right" });
    doc.text(k(l.amountToea), amountX, y, { width: 100, align: "right" });
    y += 14;
    if (l.detail !== "") {
      doc.fillColor(MUTED).fontSize(9).text(l.detail, left, y);
      doc.fontSize(10);
      y += 13;
    }
    y += 4;
  }
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
  y += 10;

  // Totals, always recomputed upstream from the lines (plan §3.4); printed as stored.
  const totalsRows: [string, number][] = [["Subtotal", invoice.subtotalToea], ...(showGst ? [["GST", invoice.gstToea] as [string, number]] : [])];
  for (const [label, amount] of totalsRows) {
    doc.fillColor(MUTED).text(label, gstX - 60, y, { width: 140, align: "right" });
    doc.fillColor(INK).text(k(amount), amountX, y, { width: 100, align: "right" });
    y += 16;
  }
  doc.font("Helvetica-Bold").fontSize(12).text("Total", gstX - 60, y, { width: 140, align: "right" });
  doc.text(k(invoice.totalToea), amountX, y, { width: 100, align: "right" });
  y += 40;

  // How to pay, with the reference in large type: it is what matches the deposit.
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Pay by bank deposit", left, y);
  y += 15;
  doc.fillColor(INK);
  for (const [label, value] of [["Bank", org.bankName], ["Account", org.bankAccount]] as const) {
    if (value === "") continue;
    doc.fillColor(MUTED).text(label, left, y, { width: 90 });
    doc.fillColor(INK).text(value, left + 90, y);
    y += 15;
  }
  y += 8;
  doc.fillColor(MUTED).text("Write this reference on your deposit", left, y);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(invoice.paymentReference, left, y + 14);

  doc.end();
  return done;
}
