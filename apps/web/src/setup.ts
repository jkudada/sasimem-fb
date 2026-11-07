/**
 * What the setup screens read and do (step 3). A landlord has 1-20 tenancies, so
 * everything is loaded at once when the signed-in app opens and reloaded after a
 * save. Screens get plain data and functions that resolve to a plain-English
 * problem, or null on success; Firebase stays in setup-store.ts.
 */
import type { InvoiceStatus, OrgProfile, Period, PropertyInput, RunStatus, TenancyDocument, TenantInput, Toea } from "@sasimem/core";

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
}

export interface Month {
  readonly period: Period;
  readonly status: RunStatus;
  readonly sendAt: Date;
  readonly totalToea: Toea;
  readonly invoiceCount: number;
  readonly invoices: readonly MonthInvoice[];
}

/** A short random ID for a new unit or charge; unique within its list is enough. */
export const newId = (): string => crypto.randomUUID().slice(0, 8);
