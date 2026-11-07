/**
 * Papua New Guinea GST (plan §3.2). 10% on taxable supplies; residential rent is
 * an exempt supply; an unregistered landlord never charges GST.
 * This is a tool, not an accountant - the UI copy says so.
 */
import { type Toea, toea } from "./money.js";
import type { GstTreatment, UseType } from "./types.js";

/**
 * GST payable on a GST-exclusive amount, rounded half up to the toea.
 * Computed in integers as floor((amount * 10 + 50) / 100): never amount * 0.1.
 */
export function gstOn(amount: Toea): Toea {
  const onMagnitude = Math.floor((Math.abs(amount) * 10 + 50) / 100);
  // A credit mirrors the charge it reverses. "+ 0" turns -0 into 0.
  return toea(amount < 0 ? -onMagnitude + 0 : onMagnitude);
}

export interface TaxableQuestion {
  readonly orgGstRegistered: boolean;
  readonly useType: UseType;
  readonly treatment: GstTreatment;
}

/** Whether one invoice line attracts GST. */
export function isTaxable(q: TaxableQuestion): boolean {
  if (!q.orgGstRegistered) return false; // an unregistered supplier cannot charge GST
  switch (q.treatment) {
    case "taxable":
      return true;
    case "exempt":
      return false;
    case "inherit":
      return q.useType === "commercial"; // residential rent is an exempt supply
    default:
      // Data from Firestore is not checked by the compiler. Refuse rather than exempt.
      throw new TypeError(`unknown GST treatment: ${JSON.stringify(q.treatment satisfies never)}`);
  }
}

export type DocumentTitle = "INVOICE" | "TAX INVOICE";

/** The words printed at the top of the page. */
export function documentTitle(q: { readonly orgGstRegistered: boolean; readonly hasTaxableLine: boolean }): DocumentTitle {
  return q.orgGstRegistered && q.hasTaxableLine ? "TAX INVOICE" : "INVOICE";
}

/** A validation message for the org's GST settings, or null. */
export function gstNumberProblem(org: { readonly gstRegistered: boolean; readonly gstNumber: string }): string | null {
  if (org.gstRegistered && org.gstNumber.trim() === "") {
    return "A GST-registered landlord must enter their GST number: it is printed on every tax invoice.";
  }
  return null;
}
