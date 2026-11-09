import { readFileSync } from "node:fs";
import { CLASSIC, FONTS, type InvoiceDocument, type InvoiceTemplate, LAYOUTS, MARKS } from "@sasimem/core";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { renderInvoicePdf } from "../src/pdf.js";
import { pdfText } from "./harness/pdf-text.js";

/** A fixed, approved invoice: what the golden file was made from. */
const invoice = (over: Partial<InvoiceDocument> = {}): InvoiceDocument => ({
  tenancyId: "k1", period: "2026-10", issueDate: "2026-10-01", dueDate: "2026-10-15", paymentReference: "KILA-OCT26",
  lines: [
    { kind: "rent", description: "Rent - Shop 1", detail: "1 - 31 October 2026", amountToea: 240_000, gstApplicable: true, gstToea: 24_000 },
    { kind: "extra", description: "Water", detail: "October 2026", amountToea: 5_000, gstApplicable: false, gstToea: 0 },
    { kind: "extra", description: "Repair credit", detail: "", amountToea: -2_000, gstApplicable: false, gstToea: 0 },
  ],
  subtotalToea: 243_000, gstToea: 24_000, totalToea: 267_000, documentTitle: "TAX INVOICE",
  tenantId: "t1", tenantName: "Kila Trading", unitLabel: "Shop 1", status: "approved", numberSeq: 142, number: "INV-0142",
  snapshot: {
    org: { name: "Wari Holdings", address: "Section 12, Lot 4, Boroko", email: "mary@wari.example", logoPath: null, gstRegistered: true, gstNumber: "500012345", bankName: "BSP", bankAccount: "1000 2345 6789" },
    tenantName: "Kila Trading", tenantEmail: "accounts@kila.example", unitLabel: "Shop 1", propertyAddress: "Lot 9, Gordons",
  },
  pdfPath: "", sentAt: null, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
  ...over,
} as InvoiceDocument);

const golden = (name: string) => readFileSync(new URL(`./golden/${name}`, import.meta.url), "utf8").trimEnd().split("\n");

/** The same invoice printed with a template. */
const withTemplate = (template: Partial<InvoiceTemplate>, over: Partial<InvoiceDocument> = {}): InvoiceDocument => {
  const base = invoice(over);
  if (base.snapshot === null) throw new Error("fixture has a snapshot");
  return { ...base, snapshot: { ...base.snapshot, template: { ...CLASSIC, ...template } } };
};

/** A residential invoice from an org not registered for GST. */
const plainInvoice = (): InvoiceDocument => {
  const base = invoice();
  if (base.snapshot === null) throw new Error("fixture has a snapshot");
  return invoice({
    documentTitle: "INVOICE", gstToea: 0 as never, totalToea: 243_000 as never,
    lines: base.lines.map((l) => ({ ...l, gstApplicable: false, gstToea: 0 as never })),
    snapshot: { ...base.snapshot, org: { ...base.snapshot.org, gstRegistered: false, gstNumber: "" } },
  });
};

const GOLDEN_LAYOUTS = { band: { layout: "band", accent: "#1f4e8c", mark: "monogram", footer: "Thank you. Rent is due on the 1st of each month." }, compact: { layout: "compact", accent: "#a3312a", font: "times", mark: "monogram" } } as const;

test.runIf(process.env["WRITE_GOLDEN"] === "1")("(re)write the golden files", async () => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL("./golden/tax-invoice.txt", import.meta.url), pdfText(await renderInvoicePdf(invoice(), null, { compress: false })).join("\n") + "\n");
  writeFileSync(new URL("./golden/tax-invoice.pdf", import.meta.url), await renderInvoicePdf(invoice(), null));
  for (const [name, t] of Object.entries(GOLDEN_LAYOUTS)) {
    writeFileSync(new URL(`./golden/${name}.txt`, import.meta.url), pdfText(await renderInvoicePdf(withTemplate(t), null, { compress: false })).join("\n") + "\n");
    writeFileSync(new URL(`./golden/${name}.pdf`, import.meta.url), await renderInvoicePdf(withTemplate(t), null));
  }
});

describe("the invoice PDF (plan §6.5)", () => {
  test("matches the golden file: letterhead, TAX INVOICE, number and dates, GST number, bill-to, lines with GST, totals, bank and reference", async () => {
    expect(pdfText(await renderInvoicePdf(invoice(), null, { compress: false }))).toEqual(golden("tax-invoice.txt"));
  });

  test("an invoice with no taxable line has no GST column, no GST total and no GST number", async () => {
    const text = pdfText(await renderInvoicePdf(plainInvoice(), null, { compress: false }));
    expect(text).toContain("INVOICE");
    expect(text.filter((t) => /GST/.test(t))).toEqual([]);
  });

  test("with a large logo it stays within 150 KB, the logo downscaled to at most 400 px", async () => {
    const noisy = await sharp(Buffer.from(Array.from({ length: 1600 * 1600 * 3 }, (_, i) => (i * 7919) % 256)), { raw: { width: 1600, height: 1600, channels: 3 } }).png().toBuffer();
    const pdf = await renderInvoicePdf(invoice(), noisy);
    expect(pdf.length).toBeLessThanOrEqual(150 * 1024);
    const sizes = [...pdf.toString("latin1").matchAll(/\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(sizes.length).toBe(1);
    expect(Math.max(...(sizes[0] ?? [Infinity]))).toBeLessThanOrEqual(400);
  });

  test("the same invoice always renders to the same bytes, so a lost upload race writes nothing different", async () => {
    expect((await renderInvoicePdf(invoice(), null)).equals(await renderInvoicePdf(invoice(), null))).toBe(true);
  });

  test("a WebP logo is converted, since PDF embeds only PNG and JPEG", async () => {
    const webp = await sharp({ create: { width: 50, height: 20, channels: 3, background: "#0d6b4f" } }).webp().toBuffer();
    const pdf = await renderInvoicePdf(invoice(), webp);
    expect(pdf.toString("latin1")).toMatch(/\/Subtype \/Image/);
  });
});

/** Pages in a PDFKit PDF. */
const pages = (pdf: Buffer): number => pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
const bigLogo = () => sharp(Buffer.from(Array.from({ length: 1600 * 1600 * 3 }, (_, i) => (i * 7919) % 256)), { raw: { width: 1600, height: 1600, channels: 3 } }).png().toBuffer();
const eleven = (): InvoiceDocument["lines"] => [
  ...invoice().lines.slice(0, 1),
  // The first charge has the longest description allowed (100), so it wraps.
  ...Array.from({ length: 10 }, (_, i) => ({ kind: "extra" as const, description: i === 0 ? "A charge with the longest description allowed, which wraps onto a second line in every layout. ".padEnd(100, "x") : `Charge ${i + 1} with a longer description`, detail: "October 2026", amountToea: 1_000 as never, gstApplicable: true, gstToea: 100 as never })),
];

describe("templates (docs/PLAN-TEMPLATES.md §4)", () => {
  test("an invoice approved before templates renders byte-identical to the golden PDF, and so does the default Classic", async () => {
    const golden = readFileSync(new URL("./golden/tax-invoice.pdf", import.meta.url));
    expect((await renderInvoicePdf(invoice(), null)).equals(golden)).toBe(true);
    expect((await renderInvoicePdf(withTemplate(CLASSIC), null)).equals(golden)).toBe(true);
  });

  test.each(Object.entries(GOLDEN_LAYOUTS))("%s matches its golden file", async (name, t) => {
    expect(pdfText(await renderInvoicePdf(withTemplate(t), null, { compress: false }))).toEqual(golden(`${name}.txt`));
  });

  const kinds = [["a tax invoice", invoice], ["a plain invoice", plainInvoice]] as const;
  test.each(LAYOUTS.flatMap((l) => kinds.map(([kind, make]) => [l.id, kind, make] as const)))("%s, %s, prints everything a tenant and the tax office need", async (layout, kind, make) => {
    const base = make();
    if (base.snapshot === null) throw new Error("fixture has a snapshot");
    const inv = { ...base, snapshot: { ...base.snapshot, template: { ...CLASSIC, layout } } };
    const text = pdfText(await renderInvoicePdf(inv, null, { compress: false })).join("\n");
    const taxable = kind === "a tax invoice";
    for (const want of [
      taxable ? "TAX INVOICE" : "INVOICE", "INV-0142", "1 October 2026", "15 October 2026", "Kila Trading", "Shop 1, Lot 9, Gordons",
      "Rent - Shop 1", "Water", "Repair credit", "K2,400.00", "K50.00", "-K20.00", "Subtotal", "K2,430.00", "Total", taxable ? "K2,670.00" : "K2,430.00",
      "Wari Holdings", "Section 12, Lot 4, Boroko", "BSP", "1000 2345 6789", "KILA-OCT26",
    ]) expect(text, want).toContain(want);
    if (taxable) for (const want of ["GST number", "500012345", "K240.00"]) expect(text, want).toContain(want);
    else expect(text).not.toMatch(/GST/);
  });

  test.each(LAYOUTS.flatMap((l) => FONTS.flatMap((f) => MARKS.map((m) => [l.id, f.id, m.id] as const))))("%s in %s with mark %s renders the same bytes every time", async (layout, font, mark) => {
    const logo = await sharp({ create: { width: 80, height: 30, channels: 3, background: "#1f4e8c" } }).png().toBuffer();
    const inv = withTemplate({ layout, font, mark, footer: "Thank you." });
    expect((await renderInvoicePdf(inv, logo)).equals(await renderInvoicePdf(inv, logo))).toBe(true);
  });

  test.each(LAYOUTS.map((l) => l.id))("%s with the largest logo, eleven lines and the longest note stays one page and within 150 KB", async (layout) => {
    const inv = withTemplate({ layout, footer: "Thank you for renting with us. ".repeat(7).slice(0, 200) }, { lines: eleven() });
    const pdf = await renderInvoicePdf(inv, await bigLogo());
    expect(pdf.length).toBeLessThanOrEqual(150 * 1024);
    expect(pages(pdf)).toBe(1);
    expect(pages(await renderInvoicePdf(inv, null))).toBe(1);
  });

  test.each(LAYOUTS.map((l) => l.id))("%s prints the note when there is one, and nothing when it is empty", async (layout) => {
    expect(pdfText(await renderInvoicePdf(withTemplate({ layout, footer: "Thank you." }), null, { compress: false }))).toContain("Thank you.");
    expect(pdfText(await renderInvoicePdf(withTemplate({ layout }), null, { compress: false })).join("\n")).not.toContain("Thank you.");
  });

  test.each(LAYOUTS.map((l) => l.id))("%s: the logo mark draws the logo; initials draw the initials, never the logo; nothing draws neither", async (layout) => {
    const logo = await sharp({ create: { width: 80, height: 30, channels: 3, background: "#1f4e8c" } }).png().toBuffer();
    const render = async (mark: InvoiceTemplate["mark"], withLogo: boolean) => {
      const pdf = await renderInvoicePdf(withTemplate({ layout, mark }), withLogo ? logo : null, { compress: false });
      return { image: /\/Subtype \/Image/.test(pdf.toString("latin1")), initials: pdfText(pdf).includes("WH") };
    };
    expect(await render("logo", true)).toEqual({ image: true, initials: false });
    expect(await render("logo", false)).toEqual({ image: false, initials: true }); // no logo uploaded: initials instead
    expect(await render("monogram", true)).toEqual({ image: false, initials: true });
    expect(await render("none", true)).toEqual({ image: false, initials: false });
  });

  test("the Times font prints in Times, with no font embedded", async () => {
    const pdf = (await renderInvoicePdf(withTemplate({ font: "times" }), null, { compress: false })).toString("latin1");
    expect(pdf).toMatch(/\/BaseFont \/Times-Roman/);
    expect(pdf).not.toMatch(/\/BaseFont \/Helvetica/);
    expect(pdf).not.toMatch(/\/FontFile/);
  });
});
