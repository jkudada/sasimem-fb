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
});
