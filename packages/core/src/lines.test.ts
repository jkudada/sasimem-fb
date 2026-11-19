import { describe, expect, test } from "vitest";
import { aCharge, aTenancy, anOrg } from "../testing/index.js";
import { draftInvoice, totals } from "./billing.js";
import { chargesGst } from "./gst.js";
import * as lines from "./lines.js";
import { parseKina, toea } from "./money.js";
import { parsePeriod } from "./period.js";
import type { TaxCode } from "./types.js";

const OCT = parsePeriod("2026-10");
const registered = { gstRegistered: true };
const unregistered = { gstRegistered: false };

describe("tax codes", () => {
  test("standard charges GST for a registered org; exempt and zero-rated never do", () => {
    expect(chargesGst("standard", true)).toBe(true);
    expect(chargesGst("exempt", true)).toBe(false);
    expect(chargesGst("zero", true)).toBe(false);
  });

  test("an unregistered org charges no GST whatever the code", () => {
    for (const code of ["standard", "exempt", "zero"] as const) expect(chargesGst(code, false)).toBe(false);
  });

  test("an unknown code from stored data is refused, not treated as exempt", () => {
    expect(() => chargesGst("luxury" as TaxCode, true)).toThrow(TypeError);
  });
});

describe("quantities are whole thousandths", () => {
  test("typed quantities parse to thousandths", () => {
    expect(lines.parseQuantity("1")).toBe(1000);
    expect(lines.parseQuantity("1.5")).toBe(1500);
    expect(lines.parseQuantity("0.25")).toBe(250);
    expect(lines.parseQuantity(" 2.125 ")).toBe(2125);
    expect(lines.parseQuantity("1,000")).toBe(1_000_000);
    expect(lines.parseQuantity(".5")).toBe(500);
  });

  test("more than three decimals, a negative, zero, letters or nothing is a plain-English problem", () => {
    for (const bad of ["1.2345", "-1", "0", "0.000", "two", "", "1.2.3", "1e3"]) {
      expect(lines.parseQuantity(bad), bad).toEqual({ problem: expect.any(String) as string });
    }
  });

  test("a quantity over a million is refused", () => {
    expect(lines.parseQuantity("1000001")).toEqual({ problem: expect.any(String) as string });
    expect(lines.parseQuantity("1000000")).toBe(lines.MAX_QUANTITY);
  });

  test("formatting drops trailing zeros and groups thousands", () => {
    expect(lines.formatQuantity(1500)).toBe("1.5");
    expect(lines.formatQuantity(1000)).toBe("1");
    expect(lines.formatQuantity(2125)).toBe("2.125");
    expect(lines.formatQuantity(250)).toBe("0.25");
    expect(lines.formatQuantity(1_000_000)).toBe("1,000");
  });
});

describe("a line's amount is quantity × unit price, rounded to the toea", () => {
  test("exact and rounded cases", () => {
    expect(lines.lineAmount(1500, parseKina("80"))).toBe(parseKina("120"));
    expect(lines.lineAmount(3000, parseKina("0.33"))).toBe(parseKina("0.99"));
    expect(lines.lineAmount(333, parseKina("1"))).toBe(33);
    expect(lines.lineAmount(335, parseKina("1"))).toBe(34); // half a toea rounds up
  });

  test("a negative unit price (a discount) mirrors the charge", () => {
    expect(lines.lineAmount(335, toea(-100))).toBe(-34);
    expect(lines.lineAmount(333, toea(-100))).toBe(-33);
  });

  test("exact at the largest quantity and price, where floats would lose toea", () => {
    expect(lines.lineAmount(lines.MAX_QUANTITY, toea(999_999_999))).toBe(999_999_999_000_000);
    expect(lines.lineAmount(1001, toea(999_999_999))).toBe(1_000_999_999); // 1,000,999,998.999 rounds up
  });
});

describe("item lines", () => {
  const labour = { description: "Labour - rewire kitchen", detail: "", quantityMilli: 1500, unit: "hour", unitPriceToea: parseKina("80"), taxCode: "standard" as const };

  test("an item line keeps its quantity, unit, unit price and tax code", () => {
    expect(lines.itemLine(labour, unregistered)).toEqual({
      kind: "item", description: "Labour - rewire kitchen", detail: "",
      quantityMilli: 1500, unit: "hour", unitPriceToea: parseKina("80"), taxCode: "standard",
      amountToea: parseKina("120"), gstApplicable: false, gstToea: 0,
    });
  });

  test("a standard-rated item for a registered org carries GST on the rounded amount", () => {
    const line = lines.itemLine({ ...labour, quantityMilli: 335, unitPriceToea: parseKina("1") }, registered);
    expect(line.amountToea).toBe(34);
    expect(line.gstApplicable).toBe(true);
    expect(line.gstToea).toBe(3); // 10% of 34 toea, half up
  });

  test("an exempt or zero-rated item carries no GST", () => {
    expect(lines.itemLine({ ...labour, taxCode: "zero" }, registered).gstToea).toBe(0);
    expect(lines.itemLine({ ...labour, taxCode: "exempt" }, registered).gstApplicable).toBe(false);
  });

  test("problems with an item: description, unit, size of the line", () => {
    expect(lines.itemLineProblems(labour)).toEqual({});
    expect(lines.itemLineProblems({ ...labour, description: "  " })).toHaveProperty("description");
    expect(lines.itemLineProblems({ ...labour, description: "x".repeat(201) })).toHaveProperty("description");
    expect(lines.itemLineProblems({ ...labour, detail: "x".repeat(201) })).toHaveProperty("detail");
    expect(lines.itemLineProblems({ ...labour, unit: "x".repeat(13) })).toHaveProperty("unit");
    expect(lines.itemLineProblems({ ...labour, quantityMilli: 0 })).toHaveProperty("quantity");
    expect(lines.itemLineProblems({ ...labour, quantityMilli: 1.5 })).toHaveProperty("quantity");
    expect(lines.itemLineProblems({ ...labour, quantityMilli: 1_000_000, unitPriceToea: parseKina("10,000.01") })).toHaveProperty("unitPrice");
    expect(lines.itemLineProblems({ ...labour, unit: "" })).toEqual({}); // a unit is optional
  });

  test("totals over rent, extra and item lines add up as before", () => {
    const rent = draftInvoice({ org: anOrg().gstRegistered().build(), tenancy: aTenancy().commercial().withRent("K1,000").build(), period: OCT });
    const all = [...rent.lines, lines.itemLine(labour, registered)];
    expect(totals(all)).toEqual({ subtotalToea: parseKina("1,120"), gstToea: parseKina("112"), totalToea: parseKina("1,232") });
  });
});

test("a drafted rent invoice's lines carry exactly today's fields", () => {
  const tenancy = aTenancy().withCharge(aCharge("Water").build()).withCharge(aCharge("Repair").onlyIn("2026-10").build()).build();
  expect(draftInvoice({ org: anOrg().build(), tenancy, period: OCT }).lines).toHaveLength(3);
  for (const line of draftInvoice({ org: anOrg().build(), tenancy, period: OCT }).lines) {
    expect(Object.keys(line).sort()).toEqual(["amountToea", "description", "detail", "gstApplicable", "gstToea", "kind"]);
  }
});

describe("where an invoice came from", () => {
  test("an invoice with no source is a rent invoice for its tenancy and month", () => {
    expect(lines.sourceOf({ tenancyId: "t1", period: OCT })).toEqual({ kind: "rent", tenancyId: "t1", period: OCT });
  });

  test("a stored source is returned as it is", () => {
    const source = { kind: "oneOff", draftId: "d1" } as const;
    expect(lines.sourceOf({ tenancyId: "", period: OCT, source })).toBe(source);
  });

  test("a new rent draft's source names its tenancy and month", () => {
    const draft = draftInvoice({ org: anOrg().build(), tenancy: aTenancy().id("t9").build(), period: OCT });
    expect(lines.rentSource(draft)).toEqual({ kind: "rent", tenancyId: "t9", period: OCT });
  });
});
