/** Domain types shared by web and functions. Pure data - no Firebase, no DOM. */
import type { Toea } from "./money.js";
import type { CalendarDate, Period } from "./period.js";
import type { InvoiceTemplate } from "./templates.js";

export type UseType = "residential" | "commercial";

/** Per-line GST treatment. "inherit" follows the property's use (the UI says "same as the rent"). */
export type GstTreatment = "inherit" | "taxable" | "exempt";

export type Recurrence = "every" | "one";

/** An additional charge on a tenancy: water, power, a levy, or a credit (negative). */
export interface Charge {
  readonly id: string;
  readonly description: string;
  readonly amountToea: Toea;
  readonly recurrence: Recurrence;
  /** The one month a `one` charge applies in; null for `every`. */
  readonly period: Period | null;
  readonly active: boolean;
  readonly gstTreatment: GstTreatment;
}

/** What drafting needs from a tenancy (the Firestore document carries more). */
export interface Tenancy {
  readonly id: string;
  readonly tenantName: string;
  readonly unitLabel: string;
  readonly useType: UseType;
  readonly rentToea: Toea;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate | null;
  /** 1-31, clamped to the month. */
  readonly billingDay: number;
  readonly dueDays: number;
  readonly referenceCode: string;
  /** In the order they were added. */
  readonly extras: readonly Charge[];
}

export type ReminderMode = "auto" | "off";

/** The organisation settings the billing rules read. */
export interface BillingOrg {
  readonly gstRegistered: boolean;
  /** IANA name, default Pacific/Port_Moresby. */
  readonly timezone: string;
  readonly sendHour: number;
  readonly approvalLeadDays: number;
  readonly reminderAfterDays: number;
  readonly reminderMode: ReminderMode;
}

export type LineKind = "rent" | "extra";

export interface Line {
  readonly kind: LineKind;
  readonly description: string;
  readonly detail: string;
  readonly amountToea: Toea;
  readonly gstApplicable: boolean;
  readonly gstToea: Toea;
}

export interface Totals {
  readonly subtotalToea: Toea;
  readonly gstToea: Toea;
  readonly totalToea: Toea;
}

export interface DraftInvoice extends Totals {
  readonly tenancyId: string;
  readonly period: Period;
  readonly issueDate: CalendarDate;
  readonly dueDate: CalendarDate;
  readonly paymentReference: string;
  readonly lines: readonly Line[];
  readonly documentTitle: "INVOICE" | "TAX INVOICE";
}

export type RunStatus = "draft" | "awaitingApproval" | "approved" | "sent" | "held" | "cancelled";
export type InvoiceStatus = "draft" | "excluded" | "approved" | "sent" | "paid" | "void";

/** The org's profile: what the landlord sets in onboarding and settings. */
export interface OrgProfile {
  readonly name: string;
  readonly address: string;
  readonly email: string;
  readonly gstRegistered: boolean;
  readonly gstNumber: string;
  readonly bankName: string;
  readonly bankAccount: string;
  readonly invoicePrefix: string;
  readonly timezone: string;
  readonly approvalLeadDays: number;
  readonly sendHour: number;
  readonly reminderAfterDays: number;
  readonly reminderMode: ReminderMode;
}

/** createOrg's input: the profile plus where invoice numbering starts (plan §4, A3). */
export interface OrgSetup extends OrgProfile {
  readonly firstInvoiceNumber: number;
}

/** Field name → plain-English problem. Empty when everything is fine. */
export type Problems<F extends string> = Partial<Record<F, string>>;

export interface Unit {
  readonly id: string;
  readonly label: string;
}

export interface PropertyInput {
  readonly address: string;
  readonly useType: UseType;
  readonly units: readonly Unit[];
  /** Overrides the org's default template for its tenancies (docs/PLAN-TEMPLATES.md §3). */
  readonly templateId?: string;
}

export interface TenantInput {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}

/** A tenancy's terms as typed: dates are still text until validated. */
export interface TenancyInput {
  readonly rentToea: Toea;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly billingDay: number;
  readonly dueDays: number;
  readonly referenceCode: string;
}

/** A tenancy as stored (plan §4), with its denormalised copies. */
export interface TenancyDocument {
  readonly propertyId: string;
  readonly unitId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly unitLabel: string;
  readonly propertyAddress: string;
  readonly useType: UseType;
  readonly rentToea: Toea;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly billingDay: number;
  readonly dueDays: number;
  readonly referenceCode: string;
  readonly invoiced: boolean;
  readonly extras: readonly Charge[];
  /** Overrides the property's template and the org's default. Not a copy: the sync trigger leaves it alone. */
  readonly templateId?: string;
}

/** What an invoice prints, frozen at approval (plan §4). Later edits never reach it. */
export interface InvoiceSnapshot {
  readonly org: {
    readonly name: string;
    readonly address: string;
    readonly email: string;
    readonly logoPath: string | null;
    readonly gstRegistered: boolean;
    readonly gstNumber: string;
    readonly bankName: string;
    readonly bankAccount: string;
  };
  readonly tenantName: string;
  readonly tenantEmail: string;
  readonly unitLabel: string;
  readonly propertyAddress: string;
  /** How it prints, resolved at approval. Absent on invoices approved before templates: they print as CLASSIC. */
  readonly template?: InvoiceTemplate;
}

/** An invoice as stored at orgs/{orgId}/invoices/{tenancyId}_{period} (plan §4). Server-written only. */
export interface InvoiceDocument extends DraftInvoice {
  readonly tenantId: string;
  /** Copied at drafting, for the review screens and numbering order; the snapshot is what prints. */
  readonly tenantName: string;
  readonly unitLabel: string;
  readonly status: InvoiceStatus;
  /** Integer part of the number; null until approval. */
  readonly numberSeq: number | null;
  readonly number: string | null;
  readonly snapshot: InvoiceSnapshot | null;
  readonly pdfPath: string;
  readonly sentAt: Date | null;
  readonly paidAt: Date | null;
  readonly paidNote: string;
  readonly remindedAt: Date | null;
  readonly remindersPaused: boolean;
}
