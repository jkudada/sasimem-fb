import { describe, expect, test } from "vitest";
import { customerOf } from "./customers.js";
import { parseKina, toea } from "./money.js";
import * as oneOff from "./oneoff.js";
import type { CalendarDate } from "./period.js";
import type { ItemLineInput } from "./types.js";

const labour: ItemLineInput = { description: "Labour", detail: "", quantityMilli: 2000, unit: "hour", unitPriceToea: parseKina("80"), taxCode: "standard" };
const cable: ItemLineInput = { description: "Cable 2.5mm", detail: "", quantityMilli: 30_000, unit: "m", unitPriceToea: parseKina("4.50"), taxCode: "standard" };
const draft: oneOff.OneOffDraft = { customerId: "c1", lines: [labour, cable], poNumber: "", notes: "", dueDays: null };
const customer = customerOf({ name: "Kila Trading", email: "accounts@kila.example", phone: "" });
const TODAY = "2026-11-19" as CalendarDate;

describe("items in the price list", () => {
  const item: oneOff.Item = { name: "Labour", description: "Qualified electrician", unit: "hour", unitPriceToea: parseKina("80"), taxCode: "standard" };

  test("a valid item has no problems", () => {
    expect(oneOff.itemProblems(item)).toEqual({});
  });

  test("name 1-100, description ≤ 200, unit ≤ 12, price within ±K10,000,000, a known tax code", () => {
    expect(oneOff.itemProblems({ ...item, name: " " })).toHaveProperty("name");
    expect(oneOff.itemProblems({ ...item, name: "x".repeat(101) })).toHaveProperty("name");
    expect(oneOff.itemProblems({ ...item, description: "x".repeat(201) })).toHaveProperty("description");
    expect(oneOff.itemProblems({ ...item, unit: "x".repeat(13) })).toHaveProperty("unit");
    expect(oneOff.itemProblems({ ...item, unitPriceToea: toea(1_000_000_001) })).toHaveProperty("unitPriceToea");
    expect(oneOff.itemProblems({ ...item, unitPriceToea: toea(-1_000_000_001) })).toHaveProperty("unitPriceToea");
    expect(oneOff.itemProblems({ ...item, taxCode: "luxury" as "standard" })).toHaveProperty("taxCode");
  });

  test("a draft line from an item copies its price and tax code; the line is its own copy", () => {
    const line = oneOff.lineFromItem(item);
    expect(line).toEqual({ description: "Labour", detail: "Qualified electrician", quantityMilli: 1000, unit: "hour", unitPriceToea: parseKina("80"), taxCode: "standard" });
    expect(item.unitPriceToea).toBe(parseKina("80"));
  });
});

describe("what is wrong with a draft", () => {
  test("a good draft has no problems", () => {
    expect(oneOff.draftProblems(draft, customer)).toEqual({});
  });

  test("it needs a customer and at least one line, and at most 30", () => {
    expect(oneOff.draftProblems({ ...draft, customerId: "" }, null)).toHaveProperty("customerId");
    expect(oneOff.draftProblems({ ...draft, lines: [] }, customer)).toHaveProperty("lines");
    expect(oneOff.draftProblems({ ...draft, lines: Array.from({ length: 31 }, () => labour) }, customer)).toHaveProperty("lines");
  });

  test("a bad line is named by its position", () => {
    const problems = oneOff.draftProblems({ ...draft, lines: [labour, { ...cable, description: "" }] }, customer);
    expect(problems.lines).toBe("Line 2: Say what this line is for.");
  });

  test("PO over 40 characters, notes over 500, due days outside 0-90", () => {
    expect(oneOff.draftProblems({ ...draft, poNumber: "x".repeat(41) }, customer)).toHaveProperty("poNumber");
    expect(oneOff.draftProblems({ ...draft, notes: "x".repeat(501) }, customer)).toHaveProperty("notes");
    expect(oneOff.draftProblems({ ...draft, dueDays: 91 }, customer)).toHaveProperty("dueDays");
    expect(oneOff.draftProblems({ ...draft, dueDays: 0 }, customer)).toEqual({});
  });

  test("the total cannot be negative: money back is a credit note", () => {
    const discount = { ...labour, description: "Discount", unitPriceToea: parseKina("-500") };
    expect(oneOff.draftProblems({ ...draft, lines: [labour, discount] }, customer).lines).toMatch(/credit note/);
  });

  test("a customer who pays only against an order number needs one", () => {
    const strict = { ...customer, poRequired: true };
    expect(oneOff.draftProblems(draft, strict)).toHaveProperty("poNumber");
    expect(oneOff.draftProblems({ ...draft, poNumber: "PO-7731" }, strict)).toEqual({});
  });
});

test("due days: the draft's, else the customer's terms, else the org's default, else 14", () => {
  expect(oneOff.dueDaysFor({ draft: 3, customer: 30, org: 7 })).toBe(3);
  expect(oneOff.dueDaysFor({ draft: null, customer: 30, org: 7 })).toBe(30);
  expect(oneOff.dueDaysFor({ draft: null, customer: null, org: 7 })).toBe(7);
  expect(oneOff.dueDaysFor({ draft: null, customer: null, org: undefined })).toBe(14);
});

describe("the issued invoice", () => {
  const issue = (gstRegistered: boolean) =>
    oneOff.issuedOneOff({ draftId: "d1", draft: { ...draft, dueDays: 7 }, customer, org: { gstRegistered, defaultTermsDays: 14 }, today: TODAY });

  test("item lines and totals from core, dated today, due by the terms, from the draft, in this month", () => {
    const inv = issue(false);
    expect(inv).toMatchObject({
      tenancyId: "", period: "2026-11", issueDate: "2026-11-19", dueDate: "2026-11-26",
      subtotalToea: parseKina("295"), gstToea: 0, totalToea: parseKina("295"), documentTitle: "INVOICE",
      source: { kind: "oneOff", draftId: "d1" },
    });
    expect(inv.lines.map((l) => l.kind)).toEqual(["item", "item"]);
  });

  test("a registered org charges GST on standard lines and prints TAX INVOICE", () => {
    expect(issue(true)).toMatchObject({ gstToea: parseKina("29.50"), totalToea: parseKina("324.50"), documentTitle: "TAX INVOICE" });
  });

  test("the payment reference is the invoice number, set when numbered", () => {
    expect(issue(false).paymentReference).toBe("");
    expect(oneOff.numbered(issue(false), "INV-0142").paymentReference).toBe("INV-0142");
  });
});

describe("reading a stored draft (the rules check its shape, not each line)", () => {
  test("a well-formed draft reads back as it is", () => {
    expect(oneOff.draftOf({ ...draft })).toEqual(draft);
    expect(oneOff.draftOf({ ...draft, dueDays: 30 }).dueDays).toBe(30);
  });

  test("a malformed line reads as one with problems, never as a crash or a trusted value", () => {
    const stored = { ...draft, lines: [labour, { description: 7, quantityMilli: "2", unitPriceToea: null, taxCode: "luxury" }, "junk"] };
    const read = oneOff.draftOf(stored);
    expect(read.lines).toHaveLength(3);
    expect(oneOff.draftProblems(read, customer).lines).toBe("Line 2: Say what this line is for.");
    expect(oneOff.draftProblems({ ...read, lines: [labour, { ...labour, quantityMilli: Number.NaN }] }, customer).lines).toMatch(/^Line 2: The quantity/);
    expect(oneOff.draftProblems({ ...read, lines: [labour, { ...labour, taxCode: "luxury" as "standard" }] }, customer).lines).toMatch(/^Line 2: Choose/);
  });

  test("missing top-level fields read as empty", () => {
    expect(oneOff.draftOf({})).toEqual({ customerId: "", lines: [], poNumber: "", notes: "", dueDays: null });
  });
});
