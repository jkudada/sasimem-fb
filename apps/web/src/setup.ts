/**
 * What the setup screens read and do (step 3). A landlord has 1-20 tenancies, so
 * everything is loaded at once when the signed-in app opens and reloaded after a
 * save. Screens get plain data and functions that resolve to a plain-English
 * problem, or null on success; Firebase stays in setup-store.ts.
 */
import type { Arrears, CalendarDate, InvoiceStatus, IssuedInvoice, OrgProfile, Period, PropertyInput, RunStatus, TenancyDocument, TenantInput, Toea } from "@sasimem/core";

export type WithId<T> = T & { readonly id: string };

export interface Org extends OrgProfile {
  readonly logoPath?: string;
}

export interface Setup {
  readonly org: Org;
  readonly properties: readonly WithId<PropertyInput>[];
  readonly tenants: readonly WithId<TenantInput>[];
  readonly tenancies: readonly WithId<TenancyDocument>[];
}

export interface Numbering {
  readonly next: number;
  readonly started: boolean;
}

/** The terms a tenancy keeps editable after it is created; its copies belong to the trigger. */
export type TenancyEdit = Pick<TenancyDocument, "rentToea" | "startDate" | "endDate" | "billingDay" | "dueDays" | "referenceCode" | "extras">;

export interface SetupStore {
  load(): Promise<Setup>;
  saveProperty(id: string | null, property: PropertyInput): Promise<string | null>;
  deleteProperty(id: string): Promise<string | null>;
  saveTenant(id: string | null, tenant: TenantInput): Promise<string | null>;
  deleteTenant(id: string): Promise<string | null>;
  createTenancy(tenancy: TenancyDocument): Promise<string | null>;
  updateTenancy(id: string, edit: TenancyEdit): Promise<string | null>;
  deleteTenancy(id: string): Promise<string | null>;
  saveProfile(profile: OrgProfile): Promise<string | null>;
  uploadLogo(file: File): Promise<string | null>;
  removeLogo(): Promise<string | null>;
  logoUrl(path: string): Promise<string | null>;
  numbering(): Promise<Numbering | string>;
  setNextNumber(next: number): Promise<string | null>;
  /** A month's run and its invoices; null when it has not been drafted. A string is a problem. */
  month(period: Period): Promise<Month | null | string>;
  draftNow(period: Period): Promise<Outcome>;
  setRent(invoiceId: string, rentToea: Toea): Promise<Outcome>;
  exclude(invoiceId: string): Promise<Outcome>;
  include(invoiceId: string): Promise<Outcome>;
  rebuildRun(period: Period): Promise<Outcome>;
  approveRun(period: Period): Promise<Outcome>;
  /** Every month that has a run, newest first. A string is a problem. */
  months(): Promise<readonly MonthSummary[] | string>;
  /** Everything sent and unpaid, by tenant (core.arrears). A string is a problem. */
  owed(): Promise<readonly Arrears<OwedInvoice>[] | string>;
  markPaid(invoiceId: string, note: string): Promise<Outcome>;
  markUnpaid(invoiceId: string): Promise<Outcome>;
  pauseReminders(invoiceId: string, paused: boolean): Promise<Outcome>;
  voidInvoice(invoiceId: string, reason: string): Promise<Outcome>;
  resendInvoice(invoiceId: string): Promise<Outcome>;
  /** Fetch the frozen PDF and open it; only a failure has a message. */
  openPdf(invoiceId: string): Promise<Outcome>;
  /** Fetch the CSV and hand it to the browser as a download. */
  exportCsv(from: Period, to: Period): Promise<Outcome>;
}

export interface MonthSummary {
  readonly period: Period;
  readonly status: RunStatus;
  readonly invoiceCount: number;
  readonly totalToea: Toea;
}

export type OwedInvoice = IssuedInvoice;

export interface EmailEntry {
  readonly id: string;
  readonly kind: string;
  readonly to: string;
  readonly subject: string;
  readonly status: "sent" | "failed";
  readonly sentAt: Date;
  readonly error: string | null;
}

/** What a run callable said, in plain words, and whether it worked. */
export interface Outcome {
  readonly ok: boolean;
  readonly message: string;
}

export interface MonthInvoice {
  readonly id: string;
  readonly tenantName: string;
  readonly unitLabel: string;
  readonly status: InvoiceStatus;
  readonly rentToea: Toea;
  readonly totalToea: Toea;
  readonly number: string | null;
  /** Set once issued; absent on older test fixtures. */
  readonly dueDate?: CalendarDate;
  readonly paidNote?: string;
  readonly remindersPaused?: boolean;
}

export interface Month {
  readonly period: Period;
  readonly status: RunStatus;
  readonly sendAt: Date;
  readonly totalToea: Toea;
  readonly invoiceCount: number;
  readonly invoices: readonly MonthInvoice[];
  /** The month's email log, newest first; empty before anything was sent. */
  readonly emails?: readonly EmailEntry[];
}

/** A short random ID for a new unit or charge; unique within its list is enough. */
export const newId = (): string => crypto.randomUUID().slice(0, 8);
