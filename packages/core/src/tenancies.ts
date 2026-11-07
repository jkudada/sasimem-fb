/**
 * Step 3: editing tenancies and their charges, and what a tenancy holds in place.
 * Screens show these problems; the rules enforce the shapes; the copies are kept
 * true by the syncTenancyCopies trigger, which calls tenancyCopies.
 */
import { isTaxable } from "./gst.js";
import { amountProblem } from "./money.js";
import { type CalendarDate, parsePeriod } from "./period.js";
import type { Charge, Problems, PropertyInput, TenancyDocument, TenantInput, UseType } from "./types.js";

/** A charge as typed: the month is still text until checked. */
export type ChargeInput = Omit<Charge, "id" | "period"> & { readonly period: string | null };

export const MAX_CHARGES = 10;

export function chargeProblems(charge: ChargeInput): Problems<"description" | "amountToea" | "period"> {
  const p: Problems<"description" | "amountToea" | "period"> = {};
  if (charge.description.trim() === "") p.description = "Say what the charge is for, such as Water.";
  else if (charge.description.length > 100) p.description = "Keep the description to 100 characters or fewer.";
  const amount = charge.amountToea === 0 ? "Enter an amount. Use a minus sign for a credit, such as -K50.00." : amountProblem(charge.amountToea);
  if (amount !== null) p.amountToea = amount;
  if (charge.recurrence === "one" && !realPeriod(charge.period)) p.period = "Choose the month this charge is for.";
  if (charge.recurrence === "every" && charge.period !== null) p.period = "A monthly charge is not tied to one month.";
  return p;
}

function realPeriod(text: string | null): boolean {
  if (text === null) return false;
  try {
    parsePeriod(text);
    return true;
  } catch {
    return false;
  }
}

export const chargesProblem = (extras: readonly unknown[]): string | null =>
  extras.length > MAX_CHARGES ? `A tenancy can have up to ${MAX_CHARGES} additional charges.` : null;

/** The words for GST treatment "inherit" (plan §3.2), with which way it falls here. */
export function sameAsRentLabel(q: { readonly orgGstRegistered: boolean; readonly useType: UseType }): string {
  const taxable = isTaxable({ ...q, treatment: "inherit" });
  return `Same as the rent (${taxable ? "GST added" : "no GST"})`;
}

export type TenancyCopies = Pick<TenancyDocument, "tenantName" | "unitLabel" | "propertyAddress" | "useType">;

/** What a tenancy's denormalised fields should say now. A vanished unit keeps its last label. */
export function tenancyCopies(
  tenancy: Pick<TenancyDocument, "unitId" | "unitLabel">,
  property: PropertyInput,
  tenant: TenantInput,
): TenancyCopies {
  const unit = property.units.find((u) => u.id === tenancy.unitId);
  return {
    tenantName: tenant.name,
    unitLabel: unit?.label ?? tenancy.unitLabel,
    propertyAddress: property.address,
    useType: property.useType,
  };
}

export type TenancyState = "upcoming" | "current" | "ended";

/** Plain calendar comparison: "YYYY-MM-DD" strings sort as dates. */
export function tenancyState(t: { readonly startDate: string; readonly endDate: string | null }, today: CalendarDate): TenancyState {
  if (t.startDate > today) return "upcoming";
  if (t.endDate !== null && t.endDate < today) return "ended";
  return "current";
}

type TenancyRef = Pick<TenancyDocument, "propertyId" | "unitId" | "tenantId">;

/** Removing a unit a tenancy points at would orphan it; renaming is fine. */
export function unitRemovalProblem(propertyId: string, before: PropertyInput, after: PropertyInput, tenancies: readonly TenancyRef[]): string | null {
  const kept = new Set(after.units.map((u) => u.id));
  const used = new Set(tenancies.filter((t) => t.propertyId === propertyId).map((t) => t.unitId));
  const lost = before.units.find((u) => !kept.has(u.id) && used.has(u.id));
  return lost === undefined ? null : `${lost.label} has a tenancy, so it cannot be removed. You can rename it.`;
}

/** A tenant or property a tenancy points at stays until the tenancy goes. */
export function deleteProblem(target: { readonly tenantId: string } | { readonly propertyId: string }, tenancies: readonly TenancyRef[]): string | null {
  const used = "tenantId" in target
    ? tenancies.some((t) => t.tenantId === target.tenantId)
    : tenancies.some((t) => t.propertyId === target.propertyId);
  return used ? "This has a tenancy. End or delete the tenancy first." : null;
}
