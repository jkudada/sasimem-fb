import { describe, expect, test } from "vitest";
import { aCharge, aTenancy, anOrg } from "../testing/index.js";
import * as billing from "./billing.js";
import { parseKina } from "./money.js";
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

test("a one-month charge appears in its month with no detail line", () => {
  const tenancy = aTenancy().withCharge(aCharge("Lock repair").amount("K80").onlyIn("2026-10").build()).build();
  const invoice = billing.draftInvoice({ org: anOrg().build(), tenancy, period: OCT });
  expect(invoice.lines[1]).toMatchObject({ description: "Lock repair", detail: "", amountToea: 8_000 });
});

test("additional charges keep the order the landlord added them in", () => {
  const tenancy = aTenancy()
    .withCharge(aCharge("Water").build())
    .withCharge(aCharge("Power").build())
    .withCharge(aCharge("Levy").build())
    .build();
  const invoice = billing.draftInvoice({ org: anOrg().build(), tenancy, period: OCT });
  expect(invoice.lines.map((l) => l.description)).toEqual(["Rent - Flat 2", "Water", "Power", "Levy"]);
});

test("a credit is a negative charge and reduces the total", () => {
  const tenancy = aTenancy().withRent("K1,200").withCharge(aCharge("Credit for repairs").amount("-K200").onlyIn("2026-10").build()).build();
  const invoice = billing.draftInvoice({ org: anOrg().build(), tenancy, period: OCT });
  expect(invoice.subtotalToea).toBe(100_000);
  expect(invoice.totalToea).toBe(100_000);
});

test("on commercial space a charge inherits GST, and an exempt override is honoured", () => {
  const tenancy = aTenancy()
    .commercial()
    .withCharge(aCharge("Power").amount("K100").build())
    .withCharge(aCharge("Bond interest").amount("K10").treatment("exempt").build())
    .build();
  const invoice = billing.draftInvoice({ org: anOrg().gstRegistered().build(), tenancy, period: OCT });
  expect(invoice.lines[1]).toMatchObject({ gstApplicable: true, gstToea: 1_000 });
  expect(invoice.lines[2]).toMatchObject({ gstApplicable: false, gstToea: 0 });
});

test("an unregistered landlord letting commercial space charges no GST and issues an INVOICE", () => {
  const tenancy = aTenancy().commercial().withCharge(aCharge("Power").treatment("taxable").build()).build();
  const invoice = billing.draftInvoice({ org: anOrg().build(), tenancy, period: OCT });
  expect(invoice.gstToea).toBe(0);
  expect(invoice.lines.every((l) => !l.gstApplicable)).toBe(true);
  expect(invoice.documentTitle).toBe("INVOICE");
});

describe("a manual rent override for one month", () => {
  test("changing the rent recomputes its GST and the totals from the lines; charges are untouched", () => {
    const tenancy = aTenancy().commercial().withRent("K2,000").withCharge(aCharge("Power").amount("K100").build()).build();
    const draft = billing.draftInvoice({ org: anOrg().gstRegistered().build(), tenancy, period: OCT });
    const edited = billing.withRent(draft, parseKina("K1,500"));
    expect(edited.lines[0]).toMatchObject({ amountToea: 150_000, gstToea: 15_000 });
    expect(edited.lines[1]).toEqual(draft.lines[1]);
    expect(edited).toMatchObject({ subtotalToea: 160_000, gstToea: 16_000, totalToea: 176_000 });
  });
});

test("a negative rent is refused: a credit is a separate charge", () => {
  const draft = billing.draftInvoice({ org: anOrg().build(), tenancy: aTenancy().build(), period: OCT });
  expect(() => billing.withRent(draft, parseKina("-1"))).toThrow(RangeError);
});

test("a one-month charge needs its month, and a recurring charge must not name one", () => {
  const base = aCharge().build();
  expect(billing.chargeProblem({ ...base, recurrence: "one", period: null })).toBe("A one-month charge needs the month it applies to.");
  expect(billing.chargeProblem({ ...base, recurrence: "every", period: OCT })).toBe("A recurring charge must not name a single month.");
  expect(billing.chargeProblem({ ...base, recurrence: "one", period: OCT })).toBeNull();
  expect(billing.chargeProblem({ ...base, recurrence: "every", period: null })).toBeNull();
});

describe("when a month's batch is sent and drafted", () => {
  // Port Moresby is UTC+10 with no daylight saving. October's batch, billed on the
  // 1st at 08:00 local, goes out at 2026-09-30T22:00Z; with 3 lead days, drafting
  // may start at 2026-09-27T22:00Z.
  const org = anOrg().sendingAt(8).leadDays(3).build();

  test("the batch goes out on the earliest billing day among active tenancies, at the send hour, landlord time", () => {
    const tenancies = [
      aTenancy().billedOn(5).build(),
      aTenancy().billedOn(3).build(),
      aTenancy().billedOn(1).ending("2026-09-30").build(), // ended: does not count
    ];
    expect(billing.sendAt({ org, tenancies, period: OCT }).toISOString()).toBe("2026-10-02T22:00:00.000Z");
  });
});

test("with no active tenancy the send day is the 1st, as in the reference app", () => {
  const org = anOrg().sendingAt(8).build();
  expect(billing.sendAt({ org, tenancies: [], period: OCT }).toISOString()).toBe("2026-09-30T22:00:00.000Z");
});

describe("which months the tick drafts", () => {
  // October's batch goes out 2026-09-30T22:00Z (1st, 08:00 Port Moresby);
  // with 3 lead days it may be drafted from 2026-09-27T22:00Z.
  const org = anOrg().sendingAt(8).leadDays(3).build();
  const tenancies = [aTenancy().starting("2026-01-01").billedOn(1).build()];
  const due = (nowIso: string, runPeriods: string[] = [], ts = tenancies, o = org) =>
    billing.periodsToDraft({ org: o, tenancies: ts, runPeriods: runPeriods.map(parsePeriod), now: new Date(nowIso) });

  test("nothing is drafted long before the lead time", () => {
    expect(due("2026-08-31T21:00:00Z")).toEqual([]); // 1 September, 07:00 local
  });
});
