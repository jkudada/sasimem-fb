import { describe, expect, test } from "vitest";
import { toea } from "./money.js";
import * as setup from "./setup.js";
import type { OrgSetup } from "./types.js";

const validOrg: OrgSetup = {
  name: "Wari Holdings",
  address: "Section 12, Lot 4, Boroko, Port Moresby",
  email: "mary@wari.example",
  gstRegistered: false,
  gstNumber: "",
  bankName: "BSP",
  bankAccount: "1000 2345 6789",
  invoicePrefix: "INV-",
  timezone: "Pacific/Port_Moresby",
  approvalLeadDays: 3,
  sendHour: 8,
  reminderAfterDays: 7,
  reminderMode: "auto",
  firstInvoiceNumber: 1,
};

describe("organisation details", () => {
  test("an organisation needs a name, of at most 100 characters", () => {
    expect(setup.orgProblems({ ...validOrg, name: "  " }).name).toBe("Enter the name that goes on your invoices.");
    expect(setup.orgProblems({ ...validOrg, name: "x".repeat(101) }).name).toBe("Keep the name to 100 characters or fewer.");
    expect(setup.orgProblems({ ...validOrg, name: "x".repeat(100) }).name).toBeUndefined();
  });

  test("the organisation's email must look like an email: approval links go there", () => {
    for (const bad of ["", "mary", "mary@", "@wari.example", "mary@wari", "mary @wari.example"]) {
      expect(setup.orgProblems({ ...validOrg, email: bad }).email, bad).toBe("Enter an email address like name@example.com.");
    }
    expect(setup.orgProblems(validOrg).email).toBeUndefined();
  });

  test("a GST-registered organisation needs its GST number, using the GST rule's own message", () => {
    expect(setup.orgProblems({ ...validOrg, gstRegistered: true, gstNumber: " " }).gstNumber).toBe(
      "A GST-registered landlord must enter their GST number: it is printed on every tax invoice.",
    );
  });
});

test("the invoice prefix is at most 10 characters, and numbering starts at a whole number of 1 or more", () => {
  expect(setup.orgProblems({ ...validOrg, invoicePrefix: "INVOICE-NO-" }).invoicePrefix).toBe("Keep the prefix to 10 characters or fewer.");
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    expect(setup.orgProblems({ ...validOrg, firstInvoiceNumber: bad }).firstInvoiceNumber, String(bad)).toBe(
      "Enter the number your next invoice should have, such as 1 or 142.",
    );
  }
  expect(setup.orgProblems({ ...validOrg, firstInvoiceNumber: 142 }).firstInvoiceNumber).toBeUndefined();
});

test("send hour is 0-23, approval lead 1-28 days and reminder delay 0-60 days, in whole numbers", () => {
  expect(setup.orgProblems({ ...validOrg, sendHour: 24 }).sendHour).toBe("Choose an hour from 0 to 23.");
  expect(setup.orgProblems({ ...validOrg, sendHour: 7.5 }).sendHour).toBe("Choose an hour from 0 to 23.");
  expect(setup.orgProblems({ ...validOrg, approvalLeadDays: 0 }).approvalLeadDays).toBe("Choose from 1 to 28 days.");
  expect(setup.orgProblems({ ...validOrg, approvalLeadDays: 29 }).approvalLeadDays).toBe("Choose from 1 to 28 days.");
  expect(setup.orgProblems({ ...validOrg, reminderAfterDays: 61 }).reminderAfterDays).toBe("Choose from 0 to 60 days.");
  expect(setup.orgProblems({ ...validOrg, sendHour: 0, approvalLeadDays: 28, reminderAfterDays: 0 })).toEqual({});
});

describe("properties", () => {
  const valid = { address: "Section 12, Lot 4, Boroko", useType: "residential" as const, units: [{ id: "u1", label: "Flat 1" }] };

  test("a property needs an address of at most 200 characters and a use type of residential or commercial", () => {
    expect(setup.propertyProblems({ ...valid, address: " " }).address).toBe("Enter the property's address.");
    expect(setup.propertyProblems({ ...valid, address: "x".repeat(201) }).address).toBe("Keep the address to 200 characters or fewer.");
    const odd = { ...valid, useType: "industrial" as unknown as "residential" };
    expect(setup.propertyProblems(odd).useType).toBe("Choose residential or commercial.");
    expect(setup.propertyProblems(valid)).toEqual({});
  });

  test("a property has at least one unit, and unit labels are filled in and different", () => {
    expect(setup.propertyProblems({ ...valid, units: [] }).units).toBe("Add at least one unit, even if it is the whole building.");
    expect(setup.propertyProblems({ ...valid, units: [{ id: "a", label: " " }] }).units).toBe("Give every unit a name, such as Flat 1.");
    const twins = [{ id: "a", label: "Flat 1" }, { id: "b", label: "flat 1 " }];
    expect(setup.propertyProblems({ ...valid, units: twins }).units).toBe("Two units have the same name.");
  });
});

test("a tenant needs a name and a valid email, because invoices are emailed; the phone is optional", () => {
  const valid = { name: "Peter Kila", email: "peter@kila.example", phone: "" };
  expect(setup.tenantProblems({ ...valid, name: "" }).name).toBe("Enter the tenant's name.");
  expect(setup.tenantProblems({ ...valid, email: "peter" }).email).toBe("Enter an email address like name@example.com.");
  expect(setup.tenantProblems(valid)).toEqual({});
});

describe("tenancies", () => {
  const valid = { rentToea: toea(120_000), startDate: "2026-01-01", endDate: null, billingDay: 1, dueDays: 7, referenceCode: "WARI" };

  test("the billing day is a whole number from 1 to 31, and due days from 0 to 90", () => {
    for (const bad of [0, 32, 1.5]) {
      expect(setup.tenancyProblems({ ...valid, billingDay: bad }).billingDay, String(bad)).toBe("Choose a day of the month from 1 to 31.");
    }
    expect(setup.tenancyProblems({ ...valid, dueDays: 91 }).dueDays).toBe("Choose from 0 to 90 days.");
    expect(setup.tenancyProblems({ ...valid, billingDay: 31, dueDays: 0 })).toEqual({});
  });

  test("the rent is not negative and not above the editable maximum", () => {
    expect(setup.tenancyProblems({ ...valid, rentToea: toea(-1) }).rentToea).toBe("Rent cannot be negative. Add a credit as a separate charge.");
    expect(setup.tenancyProblems({ ...valid, rentToea: toea(1_000_000_001) }).rentToea).toBe("That is more than K10,000,000.00. Check the amount.");
    expect(setup.tenancyProblems({ ...valid, rentToea: toea(0) }).rentToea).toBeUndefined();
  });

  test("dates are real dates, and a tenancy cannot end before it starts", () => {
    expect(setup.tenancyProblems({ ...valid, startDate: "2026-02-30" }).startDate).toBe("Enter a real date, such as 2026-10-01.");
    expect(setup.tenancyProblems({ ...valid, endDate: "someday" }).endDate).toBe("Enter a real date, such as 2026-10-01.");
    expect(setup.tenancyProblems({ ...valid, endDate: "2025-12-31" }).endDate).toBe("The end date is before the start date.");
    expect(setup.tenancyProblems({ ...valid, endDate: "2026-01-01" }).endDate).toBeUndefined();
  });

  test("the payment reference code is 1 to 12 letters or digits, since tenants type it at the bank", () => {
    for (const bad of ["", "WARI KILA", "WARI-", "ABCDEFGHIJKLM"]) {
      expect(setup.tenancyProblems({ ...valid, referenceCode: bad }).referenceCode, bad).toBe("Use 1 to 12 letters or numbers, such as WARI.");
    }
    expect(setup.tenancyProblems({ ...valid, referenceCode: "flat2b" }).referenceCode).toBeUndefined();
  });
});

test("a new organisation starts with the plan's defaults for everything onboarding does not ask", () => {
  const typed = { name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "", bankName: "BSP", bankAccount: "1000" };
  expect(setup.withOrgDefaults(typed)).toEqual({
    ...typed,
    invoicePrefix: "INV-",
    timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3,
    sendHour: 8,
    reminderAfterDays: 7,
    reminderMode: "auto",
    firstInvoiceNumber: 1,
  });
  expect(setup.withOrgDefaults({ ...typed, firstInvoiceNumber: 142, invoicePrefix: "WR-" })).toMatchObject({ firstInvoiceNumber: 142, invoicePrefix: "WR-" });
});
