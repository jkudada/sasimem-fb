import fc from "fast-check";
import { expect, test } from "vitest";
import { type CreditableInvoice, afterCreditNote, creditNoteProblems, leftOnLine, wholeInvoice } from "./credit-notes.js";
import { gstOn } from "./gst.js";
import type { Toea } from "./money.js";
import type { Line } from "./types.js";

const lineOf = (amount: number, taxed: boolean): Line => ({
  kind: "item", description: "x", detail: "", amountToea: amount as Toea, gstApplicable: taxed, gstToea: taxed ? gstOn(amount as Toea) : (0 as Toea),
});

/** Up to 5 lines, the first always positive so the invoice comes to more than 0; then credit notes taking a random share of a random line. */
const plan = fc.record({
  lines: fc.array(fc.record({ amount: fc.integer({ min: -50_000, max: 1_000_000 }).filter((n) => n !== 0), taxed: fc.boolean() }), { minLength: 1, maxLength: 5 })
    .map((ls) => [{ amount: 2_000_000, taxed: ls[0]?.taxed ?? true }, ...ls]),
  steps: fc.array(fc.record({ line: fc.nat(), share: fc.double({ min: 0.01, max: 1, noNaN: true }) }), { maxLength: 8 }),
});

test("crediting in random parts never passes a line, and crediting the rest credits the invoice in full, leaving 0 on every line", () => {
  fc.assert(fc.property(plan, ({ lines: spec, steps }) => {
    const lines = spec.map((l) => lineOf(l.amount, l.taxed));
    const total = lines.reduce((t, l) => t + l.amountToea + l.gstToea, 0) as Toea;
    let inv: CreditableInvoice = { number: "INV-0001", status: "sent", lines, totalToea: total, documentTitle: "TAX INVOICE" };
    let credited = 0;
    for (const s of steps) {
      const lineIndex = s.line % lines.length;
      const left = leftOnLine(lines[lineIndex] as Line, inv.creditNotedLines?.[lineIndex]).amountToea;
      const amount = Math.trunc(left * s.share) as Toea;
      const input = { invoiceId: "i", reason: "r", lines: [{ lineIndex, amountToea: amount }] };
      if (Object.keys(creditNoteProblems(input, inv)).length > 0) continue;
      const after = afterCreditNote(inv, input);
      credited += after.totals.totalToea;
      inv = { ...inv, ...after.invoice };
      inv.creditNotedLines?.forEach((d, n) => {
        const l = lines[n] as Line;
        expect(Math.abs(d.amountToea)).toBeLessThanOrEqual(Math.abs(l.amountToea));
        expect(Math.abs(d.gstToea)).toBeLessThanOrEqual(Math.abs(l.gstToea));
      });
    }
    const rest = { invoiceId: "i", reason: "r", lines: wholeInvoice(inv) };
    if (total - credited > 0) {
      expect(creditNoteProblems(rest, inv)).toEqual({});
      const last = afterCreditNote(inv, rest);
      inv = { ...inv, ...last.invoice };
      credited += last.totals.totalToea;
      inv.creditNotedLines?.forEach((d, n) => expect(leftOnLine(lines[n] as Line, d)).toEqual({ amountToea: 0, gstToea: 0 }));
    }
    // Credited in full. Without that last credit note, what is left on the lines (a discount
    // against a toea, say) comes to K0.00, which is no credit note at all.
    expect(credited).toBe(total);
  }));
});
