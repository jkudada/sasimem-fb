import fc from "fast-check";
import { expect, test } from "vitest";
import { totals } from "./billing.js";
import { itemLine } from "./lines.js";
import type { Toea } from "./money.js";
import type { CalendarDate } from "./period.js";
import { finalDraftFromQuote, invoiceDraftFromQuote, issuedQuote } from "./quotes.js";
import type { ItemLineInput, TaxCode } from "./types.js";

const line = fc.record({
  quantityMilli: fc.integer({ min: 1, max: 50_000 }),
  unitPriceToea: fc.integer({ min: -10_000, max: 5_000_000 }),
  taxCode: fc.constantFrom<TaxCode>("standard", "zero", "exempt"),
}).map((l): ItemLineInput => ({ description: "Work", detail: "", unit: "", ...l, unitPriceToea: l.unitPriceToea as Toea }));

test("a deposit and the final invoice together charge exactly the quote's subtotal, GST and total", () => {
  fc.assert(fc.property(fc.array(line, { minLength: 1, maxLength: 30 }), fc.integer({ min: 1, max: 100 }), fc.boolean(), (lines, percent, registered) => {
    const org = { gstRegistered: registered };
    const issued = issuedQuote({ draft: { customerId: "c1", lines, notes: "", validDays: null, revises: null }, org, today: "2026-11-20" as CalendarDate });
    const q = { ...issued, number: "QUO-0001", revision: 1, notes: "", acceptance: { name: "P", poNumber: "", acceptedOn: "2026-11-20" as CalendarDate } };
    const deposit = invoiceDraftFromQuote(q, "deposit", { depositPercent: percent }).lines.map((l) => itemLine(l, org));
    const final = finalDraftFromQuote(q, { number: "INV-0001", lines: deposit }).lines.map((l) => itemLine(l, org));
    const d = totals(deposit);
    const f = totals(final);
    expect(d.subtotalToea + f.subtotalToea).toBe(issued.subtotalToea);
    expect(d.gstToea + f.gstToea).toBe(issued.gstToea);
    expect(d.totalToea + f.totalToea).toBe(issued.totalToea);
  }));
});
