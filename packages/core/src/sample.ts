/**
 * A sample invoice for the template preview (docs/PLAN-TEMPLATES.md §4): the org's
 * real letterhead, bank and GST, a made-up tenant, drafted by the same billing rules
 * as a real one. Never stored, never numbered.
 */
import { draftInvoice } from "./billing.js";
import { invoiceSnapshot } from "./approval.js";
import { toea } from "./money.js";
import { type CalendarDate, periodOf } from "./period.js";
import type { InvoiceTemplate } from "./templates.js";
import type { InvoiceDocument, OrgProfile } from "./types.js";

export const SAMPLE_TENANT = "Sample Tenant";

export function sampleInvoice(org: OrgProfile & { readonly logoPath?: string | undefined }, template: InvoiceTemplate, today: CalendarDate): InvoiceDocument {
  const period = periodOf(today);
  // A GST-registered landlord sees a tax invoice; anyone else a plain one.
  const useType = org.gstRegistered ? "commercial" : "residential";
  const draft = draftInvoice({
    org,
    period,
    tenancy: {
      id: "sample", tenantName: SAMPLE_TENANT, unitLabel: "Flat 1", useType, rentToea: toea(120_000),
      startDate: `${period}-01` as CalendarDate, endDate: null, billingDay: 1, dueDays: 14, referenceCode: "SAMPLE",
      extras: [{ id: "w", description: "Water", amountToea: toea(5_000), recurrence: "every", period: null, active: true, gstTreatment: "inherit" }],
    },
  });
  return {
    ...draft,
    tenantId: "sample", tenantName: SAMPLE_TENANT, unitLabel: "Flat 1", status: "approved",
    numberSeq: null, number: `${org.invoicePrefix}SAMPLE`,
    snapshot: invoiceSnapshot(org, { tenantName: SAMPLE_TENANT, unitLabel: "Flat 1", propertyAddress: "Section 1, Lot 1, Boroko" }, "tenant@example.com", template),
    pdfPath: "", sentAt: null, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
  };
}
