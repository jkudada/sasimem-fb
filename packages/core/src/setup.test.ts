import { describe, expect, test } from "vitest";
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
