/**
 * Which template an invoice prints with, for the screens (docs/PLAN-TEMPLATES.md §3).
 * The same resolution approval freezes: tenancy, property, the org's default, Classic.
 */
import { CLASSIC, type InvoiceTemplate, templateFor } from "@sasimem/core";
import type { MonthInvoice, Setup } from "./setup.js";

const byId = (setup: Setup): Record<string, InvoiceTemplate> => Object.fromEntries(setup.templates.map((t) => [t.id, t]));

/** What a tenancy's invoices use now. */
export function tenancyTemplate(setup: Setup, tenancy: { readonly propertyId: string; readonly templateId?: string | undefined }): InvoiceTemplate {
  const property = setup.properties.find((p) => p.id === tenancy.propertyId);
  return templateFor({ tenancy, property, org: setup.org }, byId(setup));
}

/** What a property's tenancies use unless one overrides it; without a templateId, the org's default. */
export const propertyTemplate = (setup: Setup, property: { readonly templateId?: string | undefined }): InvoiceTemplate =>
  templateFor({ property, org: setup.org }, byId(setup));

/**
 * The template name to show beside an invoice: frozen once approved, else what approval
 * would pick now. null when there is nothing to choose between (no templates, all Classic).
 */
export function invoiceTemplateName(setup: Setup, inv: MonthInvoice): string | null {
  // Numbered means approved: frozen, and Classic if approved before templates existed.
  const frozen = inv.templateName ?? (inv.number !== null ? CLASSIC.name : undefined);
  if (setup.templates.length === 0) return frozen === undefined || frozen === CLASSIC.name ? null : frozen;
  if (frozen !== undefined) return frozen;
  const tenancy = setup.tenancies.find((t) => t.id === inv.tenancyId);
  return (tenancy === undefined ? propertyTemplate(setup, {}) : tenancyTemplate(setup, tenancy)).name;
}
