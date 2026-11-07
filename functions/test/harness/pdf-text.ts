/**
 * Text out of an uncompressed PDFKit PDF, for golden-file tests (plan §6.5). PDFKit
 * writes standard-font text as hex strings in TJ arrays; this decodes them in order,
 * one line per text operation. Enough for our own PDFs, not a general parser.
 */
export function pdfText(pdf: Buffer): string[] {
  const body = pdf.toString("latin1");
  const lines: string[] = [];
  for (const op of body.matchAll(/\[((?:<[0-9a-f]*>|\s|-?\d+(?:\.\d+)?)*)\]\s*TJ/g)) {
    const hex = [...(op[1] ?? "").matchAll(/<([0-9a-f]*)>/g)].map((m) => m[1] ?? "").join("");
    lines.push(Buffer.from(hex, "hex").toString("latin1"));
  }
  return lines;
}
