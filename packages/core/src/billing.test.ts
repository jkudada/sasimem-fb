import { describe, expect, test } from "vitest";
import { aCharge, aTenancy, anOrg } from "../testing/index.js";
import * as billing from "./billing.js";
import { parsePeriod } from "./period.js";

const OCT = parsePeriod("2026-10");

describe("which tenancies are billed in a month", () => {
  test("a tenancy that starts after the month is not billed; one starting on its last day is", () => {
    expect(billing.isActiveIn(aTenancy().starting("2026-11-01").build(), OCT)).toBe(false);
    expect(billing.isActiveIn(aTenancy().starting("2026-10-31").build(), OCT)).toBe(true);
  });
});

describe("tenancies that end", () => {
  test("a tenancy that ended before the month is not billed", () => {
    expect(billing.isActiveIn(aTenancy().ending("2026-09-30").build(), OCT)).toBe(false);
  });

  test("a tenancy ending mid-month, or on its first day, is still billed for that month", () => {
    expect(billing.isActiveIn(aTenancy().ending("2026-10-15").build(), OCT)).toBe(true);
    expect(billing.isActiveIn(aTenancy().ending("2026-10-01").build(), OCT)).toBe(true);
  });
});

describe("which additional charges apply", () => {
  test("a recurring charge applies every month", () => {
    expect(billing.chargeApplies(aCharge().every().build(), OCT)).toBe(true);
  });
});

test("a charge the landlord switched off never applies", () => {
  expect(billing.chargeApplies(aCharge().every().inactive().build(), OCT)).toBe(false);
});

test("a one-month charge applies only in the month it names", () => {
  const repair = aCharge("Repair").onlyIn("2026-10").build();
  expect(billing.chargeApplies(repair, OCT)).toBe(true);
  expect(billing.chargeApplies(repair, parsePeriod("2026-11"))).toBe(false);
});

test("the payment reference is the tenancy's code, upper-cased, then the month: WARI-OCT26", () => {
  expect(billing.paymentReference(aTenancy().reference("wari").build(), OCT)).toBe("WARI-OCT26");
});

describe("drafting one tenancy's invoice", () => {
  test("a residential tenancy gets a rent-only INVOICE with no GST", () => {
    const tenancy = aTenancy().id("t1").unit("Flat 2").withRent("K1,200").reference("wari").build();
    const invoice = billing.draftInvoice({ org: anOrg().gstRegistered().build(), tenancy, period: OCT });
    expect(invoice).toEqual({
      tenancyId: "t1",
      period: "2026-10",
      issueDate: "2026-10-01",
      dueDate: "2026-10-08",
      paymentReference: "WARI-OCT26",
      lines: [{ kind: "rent", description: "Rent - Flat 2", detail: "1 - 31 October 2026", amountToea: 120_000, gstApplicable: false, gstToea: 0 }],
      subtotalToea: 120_000,
      gstToea: 0,
      totalToea: 120_000,
      documentTitle: "INVOICE",
    });
  });
});

test("the issue date is the billing day clamped to the month, and the due date follows the tenancy's terms", () => {
  const tenancy = aTenancy().billedOn(31).dueIn(14).build();
  const invoice = billing.draftInvoice({ org: anOrg().build(), tenancy, period: parsePeriod("2026-02") });
  expect(invoice.issueDate).toBe("2026-02-28");
  expect(invoice.dueDate).toBe("2026-03-14");
});

test("commercial rent for a registered landlord carries GST and makes a TAX INVOICE", () => {
  const tenancy = aTenancy().commercial().withRent("K2,400").build();
  const invoice = billing.draftInvoice({ org: anOrg().gstRegistered().build(), tenancy, period: OCT });
  expect(invoice.lines[0]).toMatchObject({ gstApplicable: true, gstToea: 24_000 });
  expect(invoice).toMatchObject({ subtotalToea: 240_000, gstToea: 24_000, totalToea: 264_000, documentTitle: "TAX INVOICE" });
});

test("a recurring charge follows the rent, with the month as its detail", () => {
  const tenancy = aTenancy().withCharge(aCharge("Water").amount("K50").every().build()).build();
  const invoice = billing.draftInvoice({ org: anOrg().build(), tenancy, period: OCT });
  expect(invoice.lines[1]).toEqual({ kind: "extra", description: "Water", detail: "October 2026", amountToea: 5_000, gstApplicable: false, gstToea: 0 });
  expect(invoice.totalToea).toBe(125_000);
});
