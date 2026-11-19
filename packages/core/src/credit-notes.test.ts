/** G2c (docs/test-lists/general-g2.md): credit notes. */
import { describe, expect, test } from "vitest";
import * as c from "./credit-notes.js";
import type { Toea } from "./money.js";
import { arrears, invoiceChip } from "./payments.js";
import type { CalendarDate, Period } from "./period.js";
import { balanceOf } from "./receipts.js";
import type { Line } from "./types.js";

const k = (n: number) => n as Toea;
const today = "2026-11-19" as CalendarDate;

const line = (amount: number, taxed = true, over: Partial<Line> = {}): Line => ({
  kind: "item", description: `Line ${amount}`, detail: "", amountToea: k(amount), gstApplicable: taxed,
  gstToea: k(taxed ? Math.sign(amount) * Math.floor((Math.abs(amount) * 10 + 50) / 100) : 0), taxCode: taxed ? "standard" : "exempt", ...over,
});

/** Labour K100.05 + GST, exempt materials K50, a K10 discount + GST: K151.06 + GST K9.01 = K151.06... see totalToea. */
const lines = [line(10_005), line(5_000, false), line(-1_000)];
const total = lines.reduce((t, l) => t + l.amountToea + l.gstToea, 0);
const invoice = (over: Partial<c.CreditableInvoice> = {}): c.CreditableInvoice => ({
  number: "INV-0007", status: "sent", lines, totalToea: k(total), documentTitle: "TAX INVOICE", ...over,
});
const input = (ls: c.CreditLineInput[], reason = "Returned goods"): c.CreditNoteInput => ({ invoiceId: "i1", reason, lines: ls });

describe("crediting a line", () => {
  test("GST at 10% of the amount; none on an untaxed line", () => {
    expect(c.creditGst(lines[0] as Line, { amountToea: k(0), gstToea: k(0) }, k(5_000))).toBe(500);
    expect(c.creditGst(lines[1] as Line, { amountToea: k(0), gstToea: k(0) }, k(2_000))).toBe(0);
    expect(c.creditGst(lines[2] as Line, { amountToea: k(0), gstToea: k(0) }, k(-500))).toBe(-50);
  });

  test("the last of a line takes the last of its GST, and GST never passes what is left", () => {
    const l = line(15); // GST 2 (1.5 rounds up)
    const half = { amountToea: k(5), gstToea: c.creditGst(l, { amountToea: k(0), gstToea: k(0) }, k(5)) };
    expect(half.gstToea).toBe(1);
    const twice = { amountToea: k(10), gstToea: k(2) }; // 5 and 5, GST 1 and 1: all of it already
    expect(c.creditGst(l, twice, k(4))).toBe(0); // 10% would be 0 anyway
    expect(c.creditGst(l, half, k(10))).toBe(1); // the rest: the rest of the GST
    expect(c.creditGst(line(1_000), { amountToea: k(985), gstToea: k(100) }, k(10))).toBe(0); // 10% is 1, but none is left
  });

  test("what is left on a line", () => {
    expect(c.leftOnLine(lines[0] as Line, { amountToea: k(5_000), gstToea: k(500) })).toEqual({ amountToea: 5_005, gstToea: 501 });
    expect(c.leftOnLine(lines[0] as Line)).toEqual({ amountToea: 10_005, gstToea: 1_001 });
  });
});

describe("the whole invoice", () => {
  test("every line's remainder, matching the invoice's totals to the toea", () => {
    expect(c.wholeInvoice(invoice())).toEqual([{ lineIndex: 0, amountToea: 10_005 }, { lineIndex: 1, amountToea: 5_000 }, { lineIndex: 2, amountToea: -1_000 }]);
    expect(c.creditNoteLines(input(c.wholeInvoice(invoice())), invoice()).totals.totalToea).toBe(total);
  });

  test("after a part credit, the rest; a line credited in full is left out", () => {
    const first = c.afterCreditNote(invoice(), input([{ lineIndex: 0, amountToea: k(5_003) }, { lineIndex: 1, amountToea: k(5_000) }]));
    const after = invoice({ ...first.invoice });
    const rest = c.wholeInvoice(after);
    expect(rest).toEqual([{ lineIndex: 0, amountToea: 5_002 }, { lineIndex: 2, amountToea: -1_000 }]);
    const second = c.afterCreditNote(after, input(rest));
    expect(first.totals.totalToea + second.totals.totalToea).toBe(total);
    expect(second.invoice.creditNotedToea).toBe(total);
    expect(second.invoice.creditNotedLines).toEqual(lines.map((l) => ({ amountToea: l.amountToea, gstToea: l.gstToea })));
  });
});

describe("a credit note's problems", () => {
  const problems = (i: c.CreditNoteInput, inv = invoice()) => c.creditNoteProblems(i, inv);

  test("a reason is required, at most 200 characters", () => {
    expect(problems(input([{ lineIndex: 1, amountToea: k(100) }], " ")).reason).toBe("Say why you are crediting this invoice. It prints on the credit note.");
    expect(problems(input([{ lineIndex: 1, amountToea: k(100) }], "x".repeat(201))).reason).toBe("Keep the reason to 200 characters or fewer.");
    expect(problems(input([{ lineIndex: 1, amountToea: k(100) }]))).toEqual({});
  });

  test("the lines", () => {
    const one = (l: c.CreditLineInput[]) => problems(input(l)).lines;
    expect(one([])).toBe("Choose what to credit.");
    expect(one([{ lineIndex: 3, amountToea: k(1) }])).toBe("One of these lines is not on the invoice. Reload and try again.");
    expect(one([{ lineIndex: 0.5, amountToea: k(1) }])).toBe("One of these lines is not on the invoice. Reload and try again.");
    expect(one([{ lineIndex: 1, amountToea: k(1) }, { lineIndex: 1, amountToea: k(1) }])).toBe('"Line 5000" is listed twice.');
    expect(one([{ lineIndex: 1, amountToea: k(0) }])).toBe('Enter how much of "Line 5000" to credit, or leave it out.');
    expect(one([{ lineIndex: 1, amountToea: k(1.5) }])).toBe('Enter how much of "Line 5000" to credit, or leave it out.');
    expect(one([{ lineIndex: 1, amountToea: k(-1) }])).toBe('Credit "Line 5000" as a positive amount.');
    expect(one([{ lineIndex: 2, amountToea: k(500) }])).toBe('"Line -1000" is a discount: credit it as a negative amount.');
    expect(one([{ lineIndex: 1, amountToea: k(5_001) }])).toBe('Only K50.00 of "Line 5000" is left to credit.');
    expect(one([{ lineIndex: 2, amountToea: k(-500) }])).toBe("A credit note must come to more than K0.00.");
  });

  test("a line credited in full already, and more than is left of the invoice", () => {
    const done = invoice({ creditNotedLines: [{ amountToea: k(0), gstToea: k(0) }, { amountToea: k(5_000), gstToea: k(0) }], creditNotedToea: k(5_000) });
    expect(problems(input([{ lineIndex: 1, amountToea: k(1) }]), done).lines).toBe('"Line 5000" has been credited in full already.');
    // Labour's whole remainder with the discount left on: more than the invoice has left.
    const noted = invoice({ creditNotedLines: [{ amountToea: k(0), gstToea: k(0) }, { amountToea: k(5_000), gstToea: k(0) }], creditNotedToea: k(10_000) });
    expect(problems(input([{ lineIndex: 0, amountToea: k(10_005) }]), noted).lines).toBe(`Only K${((total - 10_000) / 100).toFixed(2)} of INV-0007 is left to credit.`);
  });

  test("only a sent or paid invoice", () => {
    for (const status of ["void", "draft", "approved", "excluded"] as const) {
      expect(problems(input([{ lineIndex: 1, amountToea: k(100) }]), invoice({ status })).lines, status).toBe("Only a sent or paid invoice can be credited.");
    }
    expect(problems(input([{ lineIndex: 1, amountToea: k(100) }]), invoice({ number: null })).lines).toBe("Only a sent or paid invoice can be credited.");
    expect(problems(input([{ lineIndex: 1, amountToea: k(100) }]), invoice({ status: "paid" }))).toEqual({});
  });
});

describe("where it goes", () => {
  test("off the balance first; the rest is credit", () => {
    const part = c.afterCreditNote(invoice({ amountPaidToea: k(10_000) }), input([{ lineIndex: 0, amountToea: k(10_005) }]));
    expect(part.totals.totalToea).toBe(11_006);
    expect(part.appliedToea).toBe(total - 10_000);
    expect(part.creditToea).toBe(11_006 - (total - 10_000));
    expect(part.invoice).toMatchObject({ creditedToea: total - 10_000, creditNotedToea: 11_006, status: "paid" });
  });

  test("part of a sent invoice leaves the rest owed; all of it makes it paid", () => {
    const part = c.afterCreditNote(invoice(), input([{ lineIndex: 1, amountToea: k(2_000) }]));
    expect(part).toMatchObject({ appliedToea: 2_000, creditToea: 0, invoice: { creditedToea: 2_000, status: "sent" } });
    expect(balanceOf({ ...invoice(), ...part.invoice })).toBe(total - 2_000);
    const all = c.afterCreditNote(invoice(), input(c.wholeInvoice(invoice())));
    expect(all).toMatchObject({ appliedToea: total, creditToea: 0, invoice: { status: "paid" } });
  });

  test("crediting a paid invoice is all credit", () => {
    const paid = c.afterCreditNote(invoice({ status: "paid" }), input([{ lineIndex: 1, amountToea: k(2_000) }]));
    expect(paid).toMatchObject({ appliedToea: 0, creditToea: 2_000, invoice: { creditedToea: 0, status: "paid" } });
  });

  test("the title follows the invoice's", () => {
    expect(c.creditNoteTitle(invoice())).toBe("TAX CREDIT NOTE");
    expect(c.creditNoteTitle(invoice({ documentTitle: "INVOICE" }))).toBe("CREDIT NOTE");
  });

  test("the printed lines keep the invoice's words; rent lines carry no tax code", () => {
    const rent = invoice({ lines: [{ kind: "rent", description: "Rent", detail: "November", amountToea: k(100_000), gstApplicable: false, gstToea: k(0) }] });
    expect(c.creditNoteLines(input([{ lineIndex: 0, amountToea: k(100) }]), rent).lines).toEqual([
      { kind: "rent", description: "Rent", detail: "November", amountToea: 100, gstApplicable: false, gstToea: 0 },
    ]);
  });
});

describe("balance, Still owed and the chip", () => {
  const issued = { id: "i1", tenantId: "c1", tenantName: "Kila", number: "INV-0007", period: "2026-11" as Period, status: "sent" as const, dueDate: "2026-11-30" as CalendarDate, totalToea: k(10_000) };

  test("Still owed subtracts what was credited", () => {
    expect(arrears([{ ...issued, creditedToea: k(3_000), amountPaidToea: k(2_000) }])[0]?.totalToea).toBe(5_000);
  });

  test("Credited when credited in full, paid or not; Part paid when part credited", () => {
    expect(invoiceChip({ ...issued, status: "paid", creditNotedToea: k(10_000) }, today)).toBe("Credited");
    expect(invoiceChip({ ...issued, status: "void", creditNotedToea: k(10_000) }, today)).toBe("Void");
    expect(invoiceChip({ ...issued, creditedToea: k(3_000), creditNotedToea: k(3_000) }, today)).toBe("Part paid");
    expect(invoiceChip({ ...issued, status: "paid", creditNotedToea: k(3_000) }, today)).toBe("Paid");
  });

  test("hasCreditNotes", () => {
    expect(c.hasCreditNotes({})).toBe(false);
    expect(c.hasCreditNotes({ creditNotedToea: k(1) })).toBe(true);
  });
});
