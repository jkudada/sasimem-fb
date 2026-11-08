import { readFileSync } from "node:fs";
import type { InvoiceDocument } from "@sasimem/core";
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

test.runIf(process.env["WRITE_GOLDEN"] === "1")("(re)write the golden files", async () => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL("./golden/tax-invoice.txt", import.meta.url), pdfText(await renderInvoicePdf(invoice(), null, { compress: false })).join("\n") + "\n");
  writeFileSync(new URL("./golden/tax-invoice.pdf", import.meta.url), await renderInvoicePdf(invoice(), null));
});

describe("the invoice PDF (plan §6.5)", () => {
  test("matches the golden file: letterhead, TAX INVOICE, number and dates, GST number, bill-to, lines with GST, totals, bank and reference", async () => {
    expect(pdfText(await renderInvoicePdf(invoice(), null, { compress: false }))).toEqual(golden("tax-invoice.txt"));
  });

  test("an invoice with no taxable line has no GST column, no GST total and no GST number", async () => {
    const base = invoice();
    if (base.snapshot === null) throw new Error("fixture has a snapshot");
    const plain = invoice({
      documentTitle: "INVOICE", gstToea: 0 as never, totalToea: 243_000 as never,
      lines: invoice().lines.map((l) => ({ ...l, gstApplicable: false, gstToea: 0 as never })),
      snapshot: { ...base.snapshot, org: { ...base.snapshot.org, gstRegistered: false, gstNumber: "" } },
    });
    const text = pdfText(await renderInvoicePdf(plain, null, { compress: false }));
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
