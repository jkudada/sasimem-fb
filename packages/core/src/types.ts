/** Domain types shared by web and functions. Pure data - no Firebase, no DOM. */
import type { Toea } from "./money.js";
import type { CalendarDate, Period } from "./period.js";

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
