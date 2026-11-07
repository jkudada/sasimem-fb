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
  if (q.treatment === "exempt") return false;
  return true;
}
