import { describe, expect, test } from "vitest";
import { toea } from "./money.js";
import type { CalendarDate, Period } from "./period.js";
import * as p from "./payments.js";

const d = (s: string) => s as CalendarDate;
const inv = (o: Partial<p.IssuedInvoice> = {}): p.IssuedInvoice => ({
  id: "k1_2026-10", tenantId: "t1", tenantName: "Peter Kila", number: "INV-0001", period: "2026-10" as Period,
  status: "sent", dueDate: d("2026-10-08"), totalToea: toea(120_000), ...o,
});

describe("an invoice's chip says where it stands, in plain words", () => {
  test("sent and unpaid is 'Not paid' until the due date passes, then 'Overdue' - by the landlord's day", () => {
    expect(p.invoiceChip(inv(), d("2026-10-08"))).toBe("Not paid");
    expect(p.invoiceChip(inv(), d("2026-10-09"))).toBe("Overdue");
  });

  test("every other status has its own word", () => {
    const today = d("2026-12-01");
    expect(p.invoiceChip(inv({ status: "paid" }), today)).toBe("Paid");
    expect(p.invoiceChip(inv({ status: "void" }), today)).toBe("Void");
    expect(p.invoiceChip(inv({ status: "excluded" }), today)).toBe("Left out");
    expect(p.invoiceChip(inv({ status: "draft" }), today)).toBe("Draft");
    expect(p.invoiceChip(inv({ status: "approved" }), today)).toBe("Approved");
  });
});

describe("what is owed (plan §7, screen 6)", () => {
  const invoices = [
    inv({ id: "a", tenantId: "t1", tenantName: "Peter Kila", dueDate: d("2026-10-08"), totalToea: toea(120_000) }),
    inv({ id: "b", tenantId: "t2", tenantName: "Mary Wari", dueDate: d("2026-09-08"), totalToea: toea(90_000), number: "INV-0002" }),
    inv({ id: "c", tenantId: "t1", tenantName: "Peter Kila", dueDate: d("2026-11-08"), totalToea: toea(120_000), number: "INV-0003" }),
    inv({ id: "d", tenantId: "t2", status: "paid" }),
    inv({ id: "e", tenantId: "t3", status: "void" }),
    inv({ id: "f", tenantId: "t3", status: "approved" }),
  ];

  test("unpaid sent invoices, grouped by tenant, the tenant owing longest first, oldest invoice first within", () => {
    expect(p.arrears(invoices)).toEqual([
      { tenantId: "t2", tenantName: "Mary Wari", oldestDue: "2026-09-08", totalToea: 90_000, invoices: [invoices[1]] },
      { tenantId: "t1", tenantName: "Peter Kila", oldestDue: "2026-10-08", totalToea: 240_000, invoices: [invoices[0], invoices[2]] },
    ]);
  });

  test("the total owed adds every group; paid, void and unsent invoices are not owed", () => {
    expect(p.owedTotal(p.arrears(invoices))).toBe(330_000);
    expect(p.owedTotal(p.arrears([invoices[3]!, invoices[4]!, invoices[5]!]))).toBe(0);
  });
});

test("a month's paid summary counts its issued invoices, and what is still unpaid", () => {
  expect(p.paidSummary([inv(), inv({ status: "paid", totalToea: toea(50_000) }), inv({ status: "excluded" }), inv({ status: "void" })]))
    .toEqual({ paid: 1, issued: 2, unpaidToea: 120_000 });
});

describe("voiding, notes and export ranges", () => {
  test("only an issued invoice can be voided: approved, sent or paid", () => {
    expect((["draft", "excluded", "approved", "sent", "paid", "void"] as const).filter(p.canVoid)).toEqual(["approved", "sent", "paid"]);
  });

  test("a void needs a reason, and no essay", () => {
    expect(p.voidReasonProblem("  ")).toBe("Say why this invoice is void.");
    expect(p.voidReasonProblem("x".repeat(201))).toBe("Keep the reason under 200 characters.");
    expect(p.voidReasonProblem("Tenant moved out in September")).toBeNull();
  });

  test("a paid note is optional, and short", () => {
    expect(p.paidNoteProblem("")).toBeNull();
    expect(p.paidNoteProblem("x".repeat(201))).toBe("Keep the note under 200 characters.");
  });

  test("an export runs forwards, over at most 24 months", () => {
    expect(p.exportRangeProblem("2026-01" as Period, "2026-12" as Period)).toBeNull();
    expect(p.exportRangeProblem("2026-12" as Period, "2026-01" as Period)).toBe("The first month must come before the last.");
    expect(p.exportRangeProblem("2024-01" as Period, "2026-01" as Period)).toBe("Export at most 24 months at a time.");
    expect(p.exportRangeProblem("2024-02" as Period, "2026-01" as Period)).toBeNull();
  });
});

describe("the CSV export (PLAN.md rec. 7)", () => {
  const row: p.CsvRow = {
    number: "INV-0001", issueDate: d("2026-10-01"), dueDate: d("2026-10-08"), period: "2026-10" as Period,
    tenantName: "Peter Kila", unitLabel: "Flat 1", paymentReference: "KILA-OCT26",
    subtotalToea: toea(120_000), gstToea: toea(12_000), totalToea: toea(132_000), status: "paid", paidOn: d("2026-10-05"), paidNote: "", voidReason: "",
  };

  test("a header, then one line per invoice, with amounts as plain decimals", () => {
    expect(p.invoicesCsv([row]).split("\r\n")).toEqual([
      "Number,Issue date,Due date,Month,Tenant,Unit,Payment reference,Subtotal,GST,Total,Status,Paid on,Paid note,Void reason",
      "INV-0001,2026-10-01,2026-10-08,2026-10,Peter Kila,Flat 1,KILA-OCT26,1200.00,120.00,1320.00,Paid,2026-10-05,,",
      "",
    ]);
  });

  test("commas, quotes and line breaks are quoted; credits keep their sign", () => {
    const line = p.invoicesCsv([{ ...row, tenantName: 'Kila "Big" Trading, Ltd', paidNote: "cash\nat office", totalToea: toea(-5_050) }]).split("\r\n")[1];
    expect(line).toContain('"Kila ""Big"" Trading, Ltd"');
    expect(line).toContain('"cash\nat office"');
    expect(line).toContain(",-50.50,");
  });

  test("a cell that a spreadsheet would run as a formula is defused", () => {
    const line = p.invoicesCsv([{ ...row, tenantName: "=HYPERLINK(\"x\")", paidNote: "+1", voidReason: "@SUM(A1)", unitLabel: "-2" }]).split("\r\n")[1] ?? "";
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain(",'-2,");
    expect(line).toContain(",'+1,'@SUM(A1)");
  });
});
