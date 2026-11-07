/**
 * Papua New Guinea GST (plan §3.2). 10% on taxable supplies; residential rent is
 * an exempt supply; an unregistered landlord never charges GST.
 * This is a tool, not an accountant - the UI copy says so.
 */
import { type Toea, toea } from "./money.js";

/** GST payable on a GST-exclusive amount. */
export function gstOn(amount: Toea): Toea {
  return toea(Math.floor(amount / 10));
}
