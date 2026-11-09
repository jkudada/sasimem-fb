import { describe, expect, test } from "vitest";
import { aTenancy, anOrg } from "../testing/index.js";
import * as a from "./approval.js";
import { draftInvoice } from "./billing.js";
import { parseKina, toea } from "./money.js";
import { parsePeriod } from "./period.js";
import { CLASSIC } from "./templates.js";
import type { InvoiceStatus } from "./types.js";

const OCT = parsePeriod("2026-10");

const band = { name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "monogram", footer: "Thank you." } as const;

describe("the snapshot frozen at approval (plan §4)", () => {
  test("holds the org's letterhead, bank and GST, the tenant, unit and address, and the template, as they are now", () => {
    const org = {
      name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", logoPath: "logos/o1/1.png",
      gstRegistered: true, gstNumber: "500012345", bankName: "BSP", bankAccount: "1000 2345",
      invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby", approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto" as const,
    };
    expect(a.invoiceSnapshot(org, { tenantName: "Kila Trading", unitLabel: "Shop 1", propertyAddress: "Lot 9, Gordons" }, "pay@kila.example", band)).toEqual({
      org: { name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", logoPath: "logos/o1/1.png", gstRegistered: true, gstNumber: "500012345", bankName: "BSP", bankAccount: "1000 2345" },
      tenantName: "Kila Trading", tenantEmail: "pay@kila.example", unitLabel: "Shop 1", propertyAddress: "Lot 9, Gordons",
      template: band,
    });
    expect(a.invoiceSnapshot({ ...org, logoPath: undefined }, { tenantName: "K", unitLabel: "S", propertyAddress: "L" }, "k@k.example", CLASSIC).org.logoPath).toBeNull();
  });
});

describe("redrafting a run from current tenancy data (plan §3.4)", () => {
  const org = anOrg().build();
  const peter = aTenancy().id("k1").tenant("Peter").build();
  const mary = aTenancy().id("k2").tenant("Mary").withRent("K900").build();
  const gone = aTenancy().id("k3").ending("2026-09-30").build();
  const existing = (tenancyId: string, status: InvoiceStatus) => ({ id: `${tenancyId}_2026-10`, tenancyId, status });

  test("creates drafts for newly active tenancies, rebuilds draft and excluded ones, deletes drafts for tenancies no longer active", () => {
    const plan = a.redraftPlan({ org, period: OCT, tenancies: [peter, mary, gone], existing: [existing("k1", "excluded"), existing("k3", "draft")] });
    expect(plan.create.map((d) => d.tenancyId)).toEqual(["k2"]);
    expect(plan.rebuild).toEqual([{ id: "k1_2026-10", status: "excluded", draft: draftInvoice({ org, tenancy: peter, period: OCT }) }]);
    expect(plan.remove).toEqual(["k3_2026-10"]);
  });

  test("never touches an approved, sent, paid or void invoice", () => {
    const settled = (["approved", "sent", "paid", "void"] as const).map((s, i) => existing(["k1", "k2", "k3", "k4"][i] ?? "", s));
    const plan = a.redraftPlan({ org, period: OCT, tenancies: [peter, mary], existing: settled });
    expect(plan).toEqual({ create: [], rebuild: [], remove: [] });
  });
});

describe("the approval form (plan §6.1)", () => {
  const ids = ["k1_2026-10", "k2_2026-10"];

  test("reads each row's rent as kina and which rows are ticked", () => {
    const read = a.readApprovalForm({ "rent.k1_2026-10": "K1,200", "include.k1_2026-10": "on", "rent.k2_2026-10": "900.50" }, ids);
    expect(read).toEqual({ ok: true, rents: { "k1_2026-10": 120_000, "k2_2026-10": 90_050 }, included: ["k1_2026-10"] });
  });

  test("a bad amount is a message for that row, and nothing is read", () => {
    const read = a.readApprovalForm({ "rent.k1_2026-10": "twelve", "rent.k2_2026-10": "-5" }, ids);
    expect(read).toEqual({ ok: false, problems: { "k1_2026-10": "Enter an amount like K1,200.00.", "k2_2026-10": "Rent cannot be negative." } });
  });

  test("a missing row is a stale page, not an approval of nothing", () => {
    expect(a.readApprovalForm({ "rent.k1_2026-10": "K1" }, ids)).toEqual({ ok: false, problems: { "k2_2026-10": "This page is out of date. Reload it and try again." } });
  });

  test("a changed rent re-totals from the lines; an unticked invoice is excluded; others are unchanged", () => {
    const draft = draftInvoice({ org: anOrg().build(), tenancy: aTenancy().id("k1").withRent("K1,200").build(), period: OCT });
    const other = draftInvoice({ org: anOrg().build(), tenancy: aTenancy().id("k2").withRent("K900").build(), period: OCT });
    const changes = a.applyApprovalEdits(
      [{ id: "k1_2026-10", status: "draft", draft }, { id: "k2_2026-10", status: "draft", draft: other }],
      { rents: { "k1_2026-10": parseKina("K1,000"), "k2_2026-10": parseKina("K900") }, included: ["k1_2026-10"] },
    );
    expect(changes).toEqual([
      { id: "k1_2026-10", status: "draft", draft: { ...draft, lines: [{ ...draft.lines[0], amountToea: 100_000 }], subtotalToea: 100_000, totalToea: 100_000 } },
      { id: "k2_2026-10", status: "excluded", draft: other },
    ]);
  });
});

test("the digest's subject says how many, which month, and how much", () => {
  expect(a.digestSubject({ period: OCT, count: 5, totalToea: toea(640_000) })).toBe("5 invoices ready for October 2026 - K6,400.00");
  expect(a.digestSubject({ period: OCT, count: 1, totalToea: toea(120_000) })).toBe("1 invoice ready for October 2026 - K1,200.00");
});
