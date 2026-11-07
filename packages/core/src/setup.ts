/**
 * Setup validation (step 2): the plain-English problems with what a landlord
 * typed. Screens show these; security rules enforce the same limits; createOrg
 * refuses on any of them. Problems are messages, not exceptions.
 */
import { gstNumberProblem } from "./gst.js";
import { amountProblem } from "./money.js";
import type { OrgSetup, Problems, PropertyInput, TenancyInput, TenantInput } from "./types.js";

export const MAX_NAME = 100;

export function orgProblems(org: OrgSetup): Problems<keyof OrgSetup> {
  const p: Problems<keyof OrgSetup> = {};
  if (org.name.trim() === "") p.name = "Enter the name that goes on your invoices.";
  else if (org.name.length > MAX_NAME) p.name = `Keep the name to ${MAX_NAME} characters or fewer.`;
  if (!looksLikeEmail(org.email)) p.email = EMAIL_PROBLEM;
  const gst = gstNumberProblem(org);
  if (gst !== null) p.gstNumber = gst;
  if (org.invoicePrefix.length > 10) p.invoicePrefix = "Keep the prefix to 10 characters or fewer.";
  if (!wholeIn(org.firstInvoiceNumber, 1, Number.MAX_SAFE_INTEGER)) {
    p.firstInvoiceNumber = "Enter the number your next invoice should have, such as 1 or 142.";
  }
  if (!wholeIn(org.sendHour, 0, 23)) p.sendHour = "Choose an hour from 0 to 23.";
  if (!wholeIn(org.approvalLeadDays, 1, 28)) p.approvalLeadDays = "Choose from 1 to 28 days.";
  if (!wholeIn(org.reminderAfterDays, 0, 60)) p.reminderAfterDays = "Choose from 0 to 60 days.";
  return p;
}

const EMAIL_PROBLEM = "Enter an email address like name@example.com.";

const wholeIn = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;

/** Deliberately loose: the real check is whether mail arrives. */
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export const MAX_ADDRESS = 200;

export function propertyProblems(property: PropertyInput): Problems<keyof PropertyInput> {
  const p: Problems<keyof PropertyInput> = {};
  if (property.address.trim() === "") p.address = "Enter the property's address.";
  else if (property.address.length > MAX_ADDRESS) p.address = `Keep the address to ${MAX_ADDRESS} characters or fewer.`;
  if (property.useType !== "residential" && property.useType !== "commercial") p.useType = "Choose residential or commercial.";
  const labels = property.units.map((u) => u.label.trim().toLowerCase());
  if (labels.length === 0) p.units = "Add at least one unit, even if it is the whole building.";
  else if (labels.some((l) => l === "")) p.units = "Give every unit a name, such as Flat 1.";
  else if (new Set(labels).size !== labels.length) p.units = "Two units have the same name.";
  return p;
}

export function tenantProblems(tenant: TenantInput): Problems<keyof TenantInput> {
  const p: Problems<keyof TenantInput> = {};
  if (tenant.name.trim() === "") p.name = "Enter the tenant's name.";
  else if (tenant.name.length > MAX_NAME) p.name = `Keep the name to ${MAX_NAME} characters or fewer.`;
  if (!looksLikeEmail(tenant.email)) p.email = EMAIL_PROBLEM;
  return p;
}

export function tenancyProblems(tenancy: TenancyInput): Problems<keyof TenancyInput> {
  const p: Problems<keyof TenancyInput> = {};
  if (!wholeIn(tenancy.billingDay, 1, 31)) p.billingDay = "Choose a day of the month from 1 to 31.";
  if (!wholeIn(tenancy.dueDays, 0, 90)) p.dueDays = "Choose from 0 to 90 days.";
  const rent = tenancy.rentToea < 0 ? "Rent cannot be negative. Add a credit as a separate charge." : amountProblem(tenancy.rentToea);
  if (rent !== null) p.rentToea = rent;
  return p;
}
