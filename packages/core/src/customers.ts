/**
 * Customers (docs/PLAN-GENERAL-INVOICING.md §3.1, G1b). A customer is the shared
 * record every module bills; Rentals calls it a tenant. It is stored where tenants
 * always were, orgs/{orgId}/tenants/{id}, so nothing moves: today's tenant document
 * is a customer with no business details. The rules accept exactly these fields.
 */
import { EMAIL_PROBLEM, MAX_NAME, looksLikeEmail, wholeIn } from "./setup.js";
import type { Problems, TenantInput } from "./types.js";

export interface CustomerDetails {
  /** Copy-to addresses for invoices, at most 3. */
  readonly ccEmails: readonly string[];
  readonly address: string;
  /** PNG tax identification number, printed for customers' accounts payable (§6.1). */
  readonly tin: string;
  readonly gstNumber: string;
  /** Days to pay; null means the org's default. */
  readonly termsDays: number | null;
  /** Government and corporate customers who pay only against their order number. */
  readonly poRequired: boolean;
  readonly notes: string;
}

export interface Customer extends TenantInput, CustomerDetails {}

/** The optional fields beyond a tenant's name, email and phone, in the order the rules list them. */
export const CUSTOMER_EXTRAS = ["ccEmails", "address", "tin", "gstNumber", "termsDays", "poRequired", "notes"] as const satisfies readonly (keyof CustomerDetails)[];

export const MAX_CC_EMAILS = 3;

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A stored tenant or customer document, read with defaults; malformed extras read as empty. */
export function customerOf(doc: Readonly<Record<string, unknown>>): Customer {
  const cc = doc.ccEmails;
  const terms = doc.termsDays;
  return {
    name: text(doc.name),
    email: text(doc.email),
    phone: text(doc.phone),
    ccEmails: Array.isArray(cc) ? cc.filter((e): e is string => typeof e === "string") : [],
    address: text(doc.address),
    tin: text(doc.tin),
    gstNumber: text(doc.gstNumber),
    termsDays: typeof terms === "number" ? terms : null,
    poRequired: doc.poRequired === true,
    notes: text(doc.notes),
  };
}

/** What is wrong with a customer as typed, in neutral words (Rentals keeps tenantProblems). */
export function customerProblems(c: Customer): Problems<keyof Customer> {
  const p: Problems<keyof Customer> = {};
  if (c.name.trim() === "") p.name = "Enter the customer's name.";
  else if (c.name.length > MAX_NAME) p.name = `Keep the name to ${MAX_NAME} characters or fewer.`;
  if (!looksLikeEmail(c.email)) p.email = EMAIL_PROBLEM;
  if (c.phone.length > 30) p.phone = "Keep the phone number to 30 characters or fewer.";
  if (c.ccEmails.length > MAX_CC_EMAILS) p.ccEmails = `Add up to ${MAX_CC_EMAILS} copy-to addresses.`;
  else if (c.ccEmails.some((e) => !looksLikeEmail(e))) p.ccEmails = EMAIL_PROBLEM;
  else if (c.ccEmails.some((e) => e.trim().toLowerCase() === c.email.trim().toLowerCase())) p.ccEmails = "That address already gets the invoice.";
  if (c.address.length > 200) p.address = "Keep the address to 200 characters or fewer.";
  if (c.tin.length > 20) p.tin = "Keep the TIN to 20 characters or fewer.";
  if (c.gstNumber.length > 20) p.gstNumber = "Keep the GST number to 20 characters or fewer.";
  if (c.termsDays !== null && !wholeIn(c.termsDays, 0, 90)) p.termsDays = "Choose from 0 to 90 days, or leave it blank for your usual terms.";
  if (c.notes.length > 500) p.notes = "Keep the notes to 500 characters or fewer.";
  return p;
}
