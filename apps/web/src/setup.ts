/**
 * What the setup screens read and do (step 3). A landlord has 1-20 tenancies, so
 * everything is loaded at once when the signed-in app opens and reloaded after a
 * save. Screens get plain data and functions that resolve to a plain-English
 * problem, or null on success; Firebase stays in setup-store.ts.
 */
import { customerOf } from "@sasimem/core";
import type { Arrears, BankDetails, CalendarDate, CreditableInvoice, CreditNoteInput, Customer, Interval, Item, OneOffDraft, QuoteDraft, QuoteInvoiceKind, QuoteStatus, PaymentInput, PaymentMethod, PlanId, SubscriptionFields, InvoiceStatus, InvoiceTemplate, IssuedInvoice, OrgProfile, Period, PropertyInput, RunStatus, TenancyDocument, TenantInput, Toea } from "@sasimem/core";
import type { LogoDesign } from "@sasimem/core/logo";

export type WithId<T> = T & { readonly id: string };

export interface Org extends OrgProfile {
  readonly logoPath?: string;
  /** The template new invoices use; absent (or deleted) means built-in Classic. */
  readonly defaultTemplateId?: string;
  /** The logo builder's choices, to reopen it; absent when the logo was uploaded as a file. */
  readonly logoDesign?: LogoDesign;
  /** Days to pay a one-off invoice when neither it nor the customer says (G2a); absent means 14. */
  readonly defaultTermsDays?: number;
  /** Email the owner when a scheduled one-off goes (G2d); absent means on. */
  readonly scheduledSentNote?: boolean;
  /** Quotes (G2q): days a quote is valid (absent means 30), and the terms printed on each (absent means core's default). */
  readonly quoteValidDays?: number;
  readonly quoteTerms?: string;
  /** G2q-c: a deposit of this share (1-100) on quotes over the amount (D13); absent means none. */
  readonly depositPercent?: number;
  readonly depositOverToea?: number;
  /** G2q-c: remind the customer this many days after sending a quote; absent means off. */
  readonly quoteFollowUpDays?: number;
  /** Server-written (docs/PLAN-GENERAL-INVOICING.md §3); read with core's orgFeatures. */
  readonly modules?: unknown;
  readonly features?: unknown;
}

/** What Settings saves: the profile, and the one-off settings when that part is shown. */
export type ProfileEdit = OrgProfile & {
  readonly defaultTermsDays?: number;
  readonly scheduledSentNote?: boolean;
  readonly quoteValidDays?: number;
  readonly quoteTerms?: string;
  /** G2q-c: null switches it off (the field is deleted). */
  readonly depositPercent?: number | null;
  readonly depositOverToea?: number | null;
  readonly quoteFollowUpDays?: number | null;
};

export interface Setup {
  readonly org: Org;
  readonly properties: readonly WithId<PropertyInput>[];
  /** Tenants are customers (G1b): the stored business details come along; read them with core's customerOf. */
  readonly tenants: readonly WithId<TenantInput>[];
  readonly tenancies: readonly WithId<TenancyDocument>[];
  /** Invoice templates, by name (docs/PLAN-TEMPLATES.md). */
  readonly templates: readonly WithId<InvoiceTemplate>[];
  /** The price list (G2a); loaded only when one-off invoices are on. Absent in older fixtures. */
  readonly items?: readonly WithId<Item>[];
  /** The org's Sasimem subscription (PLAN-SUBSCRIBERS S4); null if it has none or it could not be read. Absent in older fixtures. */
  readonly subscription?: SubscriptionFields | null;
  /** Where subscribers pay Sasimem; null until ops/billing-details.ts has set it. */
  readonly bank?: BankDetails | null;
}

/** A payment Sasimem recorded for this subscription. */
export interface SubscriptionPayment {
  readonly id: string;
  readonly amountToea: Toea;
  readonly receivedOn: CalendarDate;
  readonly bankReference: string;
  readonly coversFrom: CalendarDate;
  readonly coversTo: CalendarDate;
}

export interface Numbering {
  readonly next: number;
  readonly started: boolean;
}

/** The terms a tenancy keeps editable after it is created; its copies belong to the trigger. */
export type TenancyEdit = Pick<TenancyDocument, "rentToea" | "startDate" | "endDate" | "billingDay" | "dueDays" | "referenceCode" | "extras"> & {
  /** null: use the property's template, or the org's default (docs/PLAN-TEMPLATES.md §3). */
  readonly templateId: string | null;
};

export interface SetupStore {
  load(): Promise<Setup>;
  saveProperty(id: string | null, property: PropertyInput): Promise<string | null>;
  deleteProperty(id: string): Promise<string | null>;
  /** The form sends the business details only when it shows them; a merge keeps the rest. */
  saveTenant(id: string | null, tenant: TenantInput | Customer): Promise<string | null>;
  deleteTenant(id: string): Promise<string | null>;
  createTenancy(tenancy: TenancyDocument): Promise<string | null>;
  updateTenancy(id: string, edit: TenancyEdit): Promise<string | null>;
  deleteTenancy(id: string): Promise<string | null>;
  saveProfile(profile: ProfileEdit): Promise<string | null>;
  /** A file the landlord picked; it replaces any built logo, so the design is cleared. */
  uploadLogo(file: File): Promise<string | null>;
  /** Clears the logo and its design. */
  removeLogo(): Promise<string | null>;
  /** Upload the builder's PNG as the logo and keep its design, to reopen it. */
  saveLogoDesign(design: LogoDesign, png: Blob): Promise<string | null>;
  logoUrl(path: string): Promise<string | null>;
  /** Save a template; with makeDefault, also make it the org's default, in one write. */
  saveTemplate(id: string | null, template: InvoiceTemplate, makeDefault: boolean): Promise<string | null>;
  deleteTemplate(id: string): Promise<string | null>;
  /** null goes back to built-in Classic. */
  setDefaultTemplate(id: string | null): Promise<string | null>;
  /** Render a sample invoice with these settings and hand it to the browser as a download. */
  previewTemplate(template: InvoiceTemplate): Promise<Outcome>;
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
  /** The subscription's payments, newest first. A string is a problem. */
  subscriptionPayments(): Promise<readonly SubscriptionPayment[] | string>;
  /** Email Sasimem asking for another plan (the requestPlanChange callable). */
  askToChangePlan(planId: PlanId, interval: Interval, message: string): Promise<Outcome>;
  /** Zip everything (the exportEverything callable) and start the download (S6). */
  exportEverything(): Promise<ExportOutcome>;
  /** Cancel the subscription (S6). */
  cancelSubscription(): Promise<Outcome>;
  saveItem(id: string | null, item: Item): Promise<string | null>;
  deleteItem(id: string): Promise<string | null>;
  /** Saved drafts and sent one-off invoices (G2a). A string is a problem. */
  oneOffs(): Promise<OneOffs | string>;
  /** Quote drafts and sent quotes (G2q). A string is a problem. */
  quotes(): Promise<Quotes | string>;
  /** One saved quote draft; null when it is gone (sent or deleted). A string is a problem. */
  quoteDraft(id: string): Promise<QuoteDraft | null | string>;
  saveQuoteDraft(id: string | null, draft: QuoteDraft): Promise<{ readonly id: string } | { readonly problem: string }>;
  deleteQuoteDraft(id: string): Promise<string | null>;
  /** Number, freeze and email a saved quote draft (the sendQuote callable). */
  sendQuote(draftId: string): Promise<Outcome>;
  /** One sent quote with its answer (G2q-b); null when it is not there. A string is a problem. */
  quote(id: string): Promise<QuoteDetail | null | string>;
  /** Record the customer's answer by hand (the markQuote callable). */
  markQuote(id: string, answer: QuoteAnswerForm): Promise<Outcome>;
  /** Set an accepted quote back to sent (the undoAcceptance callable). */
  undoAcceptance(id: string): Promise<Outcome>;
  /** Open (or reopen) the draft that revises a sent quote (G2q-c); its id, or a problem. */
  reviseQuote(id: string): Promise<{ readonly id: string } | { readonly problem: string }>;
  /** Draft the invoice for an accepted quote: in full, a deposit, or the final one (the draftFromQuote callable). */
  draftFromQuote(id: string, kind: QuoteInvoiceKind): Promise<Outcome>;
  /** Accepted quotes with nothing invoiced, accepted before `before` (Home, AR-1). A string is a problem. */
  quotesToInvoice(before: Date): Promise<number | string>;
  /** One saved draft, with its schedule if it has one; null when it is gone (sent or deleted). A string is a problem. */
  draft(id: string): Promise<ScheduledDraft | null | string>;
  /** Save a draft; the result is its ID, or a problem. */
  saveDraft(id: string | null, draft: OneOffDraft): Promise<{ readonly id: string } | { readonly problem: string }>;
  deleteDraft(id: string): Promise<string | null>;
  /** Number, freeze and email a saved draft (the issueInvoice callable). */
  issueInvoice(draftId: string): Promise<Outcome>;
  /** Send a saved draft later, on that day at the send hour (the scheduleInvoice callable, G2d). */
  scheduleInvoice(draftId: string, sendOn: string): Promise<Outcome>;
  cancelSchedule(draftId: string): Promise<Outcome>;
  /** Every payment, newest receipt first (G2b). A string is a problem. */
  payments(): Promise<readonly PaymentRow[] | string>;
  /** Record a payment under the ID the screen made, so a retry records it once (the recordPayment callable). */
  recordPayment(paymentId: string, payment: PaymentInput, emailReceipt: boolean): Promise<Outcome>;
  undoPayment(paymentId: string, reason: string): Promise<Outcome>;
  resendReceipt(paymentId: string): Promise<Outcome>;
  /** Each customer's unused credit, by customer ID (G2c); customers with none are left out. A string is a problem. */
  credits(): Promise<ReadonlyMap<string, number> | string>;
  /** Every credit note, newest first (G2c). A string is a problem. */
  creditNotes(): Promise<readonly CreditNoteRow[] | string>;
  /** An invoice as the credit note form needs it; null when it is not there. A string is a problem. */
  creditable(invoiceId: string): Promise<CreditableRow | null | string>;
  /** Issue a credit note under the ID the screen made, so a retry issues it once (the issueCreditNote callable). */
  issueCreditNote(creditNoteId: string, input: CreditNoteInput, emailIt: boolean): Promise<Outcome>;
  resendCreditNote(creditNoteId: string): Promise<Outcome>;
  /** Fetch a credit note's PDF and hand it to the browser; only a failure has a message. */
  openCreditNotePdf(creditNoteId: string): Promise<Outcome>;
}

/** An invoice as the credit note form sees it (G2c). */
export interface CreditableRow extends CreditableInvoice {
  readonly id: string;
  readonly customerName: string;
}

/** A credit note as the list shows it (G2c). */
export interface CreditNoteRow {
  readonly id: string;
  readonly number: string;
  readonly invoiceNumber: string;
  readonly customerName: string;
  readonly issueDate: CalendarDate;
  readonly reason: string;
  readonly totalToea: Toea;
  readonly appliedToea: Toea;
  readonly creditToea: Toea;
}

/** A payment as the screens show it (G2b). */
export interface PaymentRow {
  readonly id: string;
  /** "" when nothing was received: it only used credit (G2c). */
  readonly receiptNumber: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly receivedOn: CalendarDate;
  readonly amountToea: Toea;
  readonly method: PaymentMethod;
  readonly reference: string;
  readonly allocations: readonly { readonly number: string; readonly amountToea: Toea }[];
  readonly creditToea: Toea;
  /** Their credit it used as well (G2c). */
  readonly creditUsedToea?: Toea;
  readonly status: "recorded" | "undone";
  readonly undoReason: string;
}

/** A draft's schedule (G2d, `sendLater/{draftId}`): the day it goes, or why it did not. */
export interface SendLater {
  readonly sendOn: CalendarDate;
  /** Set when the tick could not send it; it is not tried again. */
  readonly problem?: string;
}

export type ScheduledDraft = OneOffDraft & { readonly sendLater?: SendLater };

export interface OneOffs {
  /** Drafts, in the order the store found them. */
  readonly drafts: readonly WithId<ScheduledDraft>[];
  /** Newest number first. */
  readonly invoices: readonly OneOffInvoice[];
}

export interface Quotes {
  readonly drafts: readonly WithId<QuoteDraft>[];
  /** Newest number first. */
  readonly sent: readonly SentQuote[];
}

export interface SentQuote {
  readonly id: string;
  /** "QUO-0012", or "QUO-0012 rev 2". */
  readonly label: string;
  readonly customerName: string;
  readonly issueDate: CalendarDate;
  readonly validUntil: CalendarDate;
  readonly totalToea: Toea;
  readonly status: QuoteStatus;
}

/** A sent quote as its own screen shows it (G2q-b, G2q-c). */
export interface QuoteDetail extends SentQuote {
  /** "QUO-0012": the label without its revision. */
  readonly number: string;
  readonly revision: number;
  /** When the customer first opened the link. */
  readonly viewedAt: Date | null;
  readonly acceptance: { readonly by: "customer" | "owner"; readonly name: string; readonly poNumber: string; readonly at: Date; readonly totalToea: Toea } | null;
  readonly decline: { readonly by: "customer" | "owner"; readonly reason: string; readonly at: Date } | null;
  /** The invoices sent from it, and what they came to (G2q-c). */
  readonly invoiceIds: readonly string[];
  readonly invoicedToea: Toea;
  readonly invoices: readonly { readonly id: string; readonly number: string; readonly totalToea: Toea; readonly kind: QuoteInvoiceKind }[];
  /** Its invoice drafts not yet sent, by kind (G2q-c). */
  readonly drafts: readonly QuoteInvoiceKind[];
  /** The revisions it replaced, oldest first (G2q-c). */
  readonly revisions: readonly { readonly revision: number; readonly issueDate: CalendarDate; readonly totalToea: Toea; readonly status: QuoteStatus }[];
}

/** What the owner records, as markQuote reads it. */
export interface QuoteAnswerForm {
  readonly answer: "accept" | "decline";
  readonly name: string;
  readonly poNumber: string;
  readonly reason: string;
}

export interface OneOffInvoice {
  readonly id: string;
  readonly number: string;
  readonly customerName: string;
  readonly issueDate: CalendarDate;
  readonly dueDate: CalendarDate;
  readonly totalToea: Toea;
  readonly status: InvoiceStatus;
  /** Recorded payments (G2b); absent before any. */
  readonly amountPaidToea?: Toea;
  /** Credit notes (G2c): off the balance, and in all; absent before any. */
  readonly creditedToea?: Toea;
  readonly creditNotedToea?: Toea;
}

/** An export's outcome: when it worked, the hour-long link to download it again. */
export type ExportOutcome = Outcome & { readonly url?: string };

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
  /** Absent on older test fixtures. */
  readonly tenancyId?: string;
  /** The template frozen at approval; absent before approval and on invoices from before templates. */
  readonly templateName?: string;
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
  /** Recorded payments (G2b); absent before any. */
  readonly amountPaidToea?: Toea;
  /** Credit notes (G2c): off the balance, and in all; absent before any. */
  readonly creditedToea?: Toea;
  readonly creditNotedToea?: Toea;
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

/** A tenant as a customer, with the business details stored beside the name (G1b), read defensively. */
export const customerFrom = (t: WithId<TenantInput>): Customer => customerOf(t as unknown as Readonly<Record<string, unknown>>);

/** A short random ID for a new unit or charge; unique within its list is enough. */
export const newId = (): string => crypto.randomUUID().slice(0, 8);
