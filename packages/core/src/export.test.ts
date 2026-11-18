import { describe, expect, test } from "vitest";
import * as x from "./export.js";
import { toea } from "./money.js";
import type { CalendarDate, Period } from "./period.js";

const d = (s: string) => s as CalendarDate;

describe("export everything (PLAN-SUBSCRIBERS §11, S6)", () => {
  test("properties: one line per unit, so a spreadsheet can filter by property", () => {
    expect(x.propertiesCsv([
      { id: "p2", address: "Lot 5, Boroko", useType: "commercial", units: [{ id: "u1", label: "Shop 1" }] },
      { id: "p1", address: "12 Hohola Rd, \"Waigani\"", useType: "residential", units: [{ id: "a", label: "Flat 1" }, { id: "b", label: "Flat 2" }] },
    ])).toBe([
      "property_id,address,use,unit_id,unit",
      "p1,\"12 Hohola Rd, \"\"Waigani\"\"\",residential,a,Flat 1",
      "p1,\"12 Hohola Rd, \"\"Waigani\"\"\",residential,b,Flat 2",
      "p2,\"Lot 5, Boroko\",commercial,u1,Shop 1",
      "",
    ].join("\r\n"));
  });

  test("tenants, sorted by name, and a formula typed as a name is not run", () => {
    expect(x.tenantsCsv([
      { id: "t2", name: "Vele Kila", email: "vele@example.com", phone: "" },
      { id: "t1", name: "=HYPERLINK(\"x\")", email: "a@example.com", phone: "+675 7000 0000" },
    ])).toBe([
      "tenant_id,name,email,phone",
      "t1,\"'=HYPERLINK(\"\"x\"\")\",a@example.com,'+675 7000 0000",
      "t2,Vele Kila,vele@example.com,",
      "",
    ].join("\r\n"));
  });

  test("tenancies and their extra charges, in kina", () => {
    const tenancy = {
      id: "k1", tenantId: "t1", tenantName: "Vele Kila", propertyId: "p1", propertyAddress: "12 Hohola Rd", unitId: "a", unitLabel: "Flat 1",
      useType: "residential" as const, rentToea: toea(150_000), startDate: d("2026-01-01"), endDate: null, billingDay: 1, dueDays: 7, referenceCode: "VK1",
      extras: [
        { id: "c1", description: "Water", amountToea: toea(5_050), recurrence: "every" as const, period: null, active: true, gstTreatment: "inherit" as const },
        { id: "c2", description: "Repairs, door", amountToea: toea(20_000), recurrence: "one" as const, period: "2026-03" as Period, active: false, gstTreatment: "taxable" as const },
      ],
    };
    expect(x.tenanciesCsv([tenancy, { ...tenancy, id: "k0", tenantName: "Ann", endDate: d("2026-06-30"), extras: [] }])).toBe([
      "tenancy_id,tenant_id,tenant,property_id,property,unit_id,unit,use,rent,start,end,billing_day,due_days,reference",
      "k0,t1,Ann,p1,12 Hohola Rd,a,Flat 1,residential,1500.00,2026-01-01,2026-06-30,1,7,VK1",
      "k1,t1,Vele Kila,p1,12 Hohola Rd,a,Flat 1,residential,1500.00,2026-01-01,,1,7,VK1",
      "",
    ].join("\r\n"));
    expect(x.chargesCsv([tenancy])).toBe([
      "tenancy_id,charge_id,description,amount,recurrence,month,active,gst",
      "k1,c1,Water,50.50,every month,,yes,as the organisation",
      "k1,c2,\"Repairs, door\",200.00,once,2026-03,no,taxable",
      "",
    ].join("\r\n"));
  });

  test("payments: the paid invoices, by date paid", () => {
    expect(x.paymentsCsv([
      { number: "INV-0002", tenantName: "Vele Kila", unitLabel: "Flat 1", totalToea: toea(155_050), paidOn: d("2026-03-04"), paidNote: "BSP transfer" },
      { number: "INV-0001", tenantName: "Ann", unitLabel: "Flat 2", totalToea: toea(100_000), paidOn: d("2026-02-10"), paidNote: "" },
    ])).toBe([
      "invoice,tenant,unit,amount,paid_on,note",
      "INV-0001,Ann,Flat 2,1000.00,2026-02-10,",
      "INV-0002,Vele Kila,Flat 1,1550.50,2026-03-04,BSP transfer",
      "",
    ].join("\r\n"));
  });

  test("the zip and PDF names are safe in any file system", () => {
    expect(x.exportFilename("Wari Holdings / Boroko", d("2026-11-18"))).toBe("sasimem-wari-holdings-boroko-2026-11-18.zip");
    expect(x.exportFilename("  ", d("2026-11-18"))).toBe("sasimem-export-2026-11-18.zip");
    expect(x.exportPdfName("INV-0001", "k")).toBe("invoices/INV-0001.pdf");
    expect(x.exportPdfName(null, "abc")).toBe("invoices/abc.pdf");
    expect(x.exportPdfName("A/B:1", "abc")).toBe("invoices/A-B-1.pdf");
  });

  test("an export link lasts an hour", () => {
    expect(x.EXPORT_LINK_MINUTES).toBe(60);
  });
});
