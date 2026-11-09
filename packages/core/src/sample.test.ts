import { expect, test } from "vitest";
import { anOrg } from "../testing/index.js";
import type { CalendarDate } from "./period.js";
import { SAMPLE_TENANT, sampleInvoice } from "./sample.js";
import { CLASSIC } from "./templates.js";

const today = "2026-11-08" as CalendarDate;
const profile = { name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstNumber: "", bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-" };

test("a landlord not registered for GST previews a plain invoice for this month, with their details and the template", () => {
  const inv = sampleInvoice({ ...anOrg().build(), ...profile, gstRegistered: false }, { ...CLASSIC, layout: "band" }, today);
  expect(inv).toMatchObject({ documentTitle: "INVOICE", period: "2026-11", number: "INV-SAMPLE", gstToea: 0, totalToea: 125_000, tenantName: SAMPLE_TENANT });
  expect(inv.snapshot).toMatchObject({ org: { name: "Wari Holdings", bankName: "BSP" }, tenantName: SAMPLE_TENANT, template: { layout: "band" } });
});

test("a GST-registered landlord previews a tax invoice with GST on each line", () => {
  const inv = sampleInvoice({ ...anOrg().build(), ...profile, gstRegistered: true, gstNumber: "500012345" }, CLASSIC, today);
  expect(inv).toMatchObject({ documentTitle: "TAX INVOICE", gstToea: 12_500, totalToea: 137_500 });
  expect(inv.lines.every((l) => l.gstApplicable)).toBe(true);
});
