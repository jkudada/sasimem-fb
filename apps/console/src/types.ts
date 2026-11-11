/** What the console reads, as plain data. data.ts turns Firestore documents into these. */
import type { CalendarDate, PlanId, RunStatus, SubscriptionFields } from "@sasimem/core";

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date | null;
}

export interface OrgDetail extends OrgSummary {
  readonly address: string;
  readonly gstRegistered: boolean;
  readonly gstNumber: string;
  readonly timezone: string;
}

export interface RunSummary {
  readonly period: string;
  readonly status: RunStatus;
  readonly approvedAt: Date | null;
  readonly invoiceCount: number;
  readonly totalToea: number;
}

export interface EmailSummary {
  readonly id: string;
  readonly kind: string;
  readonly to: string;
  readonly subject: string;
  readonly status: "sent" | "failed";
  readonly sentAt: Date;
  readonly error: string | null;
}

/** Everything the Subscribers list needs for one org. */
export interface SubscriberInput {
  readonly org: OrgSummary;
  readonly sub: SubscriptionFields | null;
  readonly runs: readonly RunSummary[];
  /** The last 30 days only. */
  readonly emails: readonly EmailSummary[];
}

export interface Payment {
  readonly id: string;
  readonly amountToea: number;
  readonly receivedOn: CalendarDate;
  readonly bankReference: string;
}

export interface Note {
  readonly id: string;
  readonly text: string;
  readonly by: string;
  readonly at: Date;
}

export interface OperatorEvent {
  readonly id: string;
  readonly kind: string;
  readonly actor: string;
  /** The operator's email when the event recorded it. */
  readonly actorEmail: string;
  readonly at: Date;
  /** What changed: each field, before and after. */
  readonly changes: readonly { readonly field: string; readonly before: unknown; readonly after: unknown }[];
}

/** An invitation to sign up (signupInvites), as the Invites page shows it. */
export interface Invite {
  readonly email: string;
  /** Null for an invitation from before plans: the standard trial. */
  readonly planId: PlanId | null;
  readonly trialDays: number | null;
  readonly expiresAt: Date | null;
  readonly invitedAt: Date | null;
  readonly used: boolean;
  readonly sendCount: number;
  readonly lastError: string | null;
}

export interface InvoiceSummary {
  readonly id: string;
  readonly number: string | null;
  readonly tenantName: string;
  readonly status: string;
  readonly totalToea: number;
}

export interface SubscriberDetail {
  readonly org: OrgDetail;
  readonly sub: SubscriptionFields | null;
  readonly payments: readonly Payment[];
  readonly notes: readonly Note[];
  readonly events: readonly OperatorEvent[];
  readonly runs: readonly RunSummary[];
  readonly emails: readonly EmailSummary[];
  /** The latest run's invoices. */
  readonly invoices: readonly InvoiceSummary[];
}

export interface TickBeat {
  readonly lastSuccessAt: Date;
  readonly tally: Readonly<Record<string, number>>;
}
