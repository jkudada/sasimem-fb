/**
 * Runs and invoices: drafting and redrafting (plan §3.4). The only code that
 * creates them. Every write is a create() keyed by period and tenancy, so a
 * doubled call can never make a second run or invoice (I1, I2).
 */
import {
  type BillingOrg, type DraftInvoice, type InvoiceDocument, type InvoiceStatus, type OrgProfile, type Period, type Tenancy,
  type RunStatus, type TenancyDocument, isActiveIn, redraftPlan, sendAt,
} from "@sasimem/core";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { db } from "../admin.js";

export type OrgDoc = OrgProfile & { readonly logoPath?: string; readonly defaultTemplateId?: string };

export const invoiceId = (tenancyId: string, period: Period): string => `${tenancyId}_${period}`;

export function refs(orgId: string, firestore: Firestore = db()) {
  const org = firestore.doc(`orgs/${orgId}`);
  return {
    org,
    run: (period: Period) => org.collection("runs").doc(period),
    invoice: (id: string) => org.collection("invoices").doc(id),
    invoicesOf: (period: Period) => org.collection("invoices").where("period", "==", period),
    tenancies: org.collection("tenancies"),
    tenant: (id: string) => org.collection("tenants").doc(id),
    counter: org.collection("private").doc("counter"),
    issued: (n: number) => org.collection("issuedNumbers").doc(String(n)),
    events: org.collection("events"),
    templates: org.collection("templates"),
  };
}

const DRAFT_FIELDS = ["tenancyId", "period", "issueDate", "dueDate", "paymentReference", "lines", "subtotalToea", "gstToea", "totalToea", "documentTitle"] as const;

/** The draft part of a stored invoice, as core's billing rules see it. */
export const asDraft = (inv: InvoiceDocument): DraftInvoice => Object.fromEntries(DRAFT_FIELDS.map((k) => [k, inv[k]])) as unknown as DraftInvoice;

/** A tenancy document as core's billing rules see it. */
export const asTenancy = (id: string, d: TenancyDocument): Tenancy & TenancyDocument => ({ ...d, id }) as Tenancy & TenancyDocument;

/** The fields a new invoice document starts with, around core's draft. */
function newInvoice(draft: DraftInvoice, tenancy: TenancyDocument) {
  return {
    ...draft,
    tenantId: tenancy.tenantId, tenantName: tenancy.tenantName, unitLabel: tenancy.unitLabel,
    status: "draft" as InvoiceStatus, numberSeq: null, number: null, snapshot: null, pdfPath: "",
    sentAt: null, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
  };
}

export type DraftOutcome = "drafted" | "exists" | "nothingToDraft";

/** Draft a period's run and invoices if it has none. Never redrafts: that is rebuildRun's job. */
export async function draftRun(orgId: string, period: Period, now: Date): Promise<DraftOutcome> {
  const r = refs(orgId);
  return db().runTransaction(async (tx) => {
    if ((await tx.get(r.run(period))).exists) return "exists";
    const { org, tenancies } = await readBilling(tx, r);
    const active = tenancies.filter((t) => isActiveIn(t, period));
    if (active.length === 0) return "nothingToDraft";
    const plan = redraftPlan({ org, period, tenancies: active, existing: [] });
    const byId = new Map(active.map((t) => [t.id, t]));
    let total = 0;
    for (const draft of plan.create) {
      const tenancy = byId.get(draft.tenancyId);
      if (tenancy === undefined) continue;
      tx.create(r.invoice(invoiceId(tenancy.id, period)), newInvoice(draft, tenancy));
      total += draft.totalToea;
    }
    tx.create(r.run(period), {
      status: "draft",
      sendAt: Timestamp.fromDate(sendAt({ org, tenancies: active, period })),
      approvalExpiresAt: null, approvalSentAt: null, approvedAt: null, sentAt: null, heldNotifiedAt: null,
      createdAt: Timestamp.fromDate(now),
      totalToea: total,
      invoiceCount: plan.create.length,
    });
    return "drafted";
  });
}

/** The org and its tenancies, read inside a transaction. */
export async function readBilling(tx: Transaction, r: ReturnType<typeof refs>): Promise<{ org: OrgDoc & BillingOrg; tenancies: (Tenancy & TenancyDocument)[] }> {
  const [orgSnap, tenancySnap] = await Promise.all([tx.get(r.org), tx.get(r.tenancies)]);
  const org = orgSnap.data() as OrgDoc & BillingOrg | undefined;
  if (org === undefined) throw new Error(`no organisation ${r.org.id}`);
  return { org, tenancies: tenancySnap.docs.map((d) => asTenancy(d.id, d.data() as TenancyDocument)) };
}

/** Every org's ID, or just the given ones (tests run the tick over their own orgs, plan §9.3). */
export async function orgIdsToTick(only?: readonly string[]): Promise<string[]> {
  if (only !== undefined) return [...only];
  return (await db().collection("orgs").select().get()).docs.map((d) => d.id);
}

/** The periods an org already has runs for. */
export async function runPeriodsOf(orgId: string): Promise<Period[]> {
  return (await refs(orgId).org.collection("runs").select().get()).docs.map((d) => d.id as Period);
}

export interface RunRef {
  readonly orgId: string;
  readonly period: Period;
  readonly status: RunStatus;
  readonly sendAt: Date;
}

/** Runs in one status, across orgs (the collection-group index on runs.status). */
export async function runsIn(status: RunStatus, orgIds?: readonly string[]): Promise<RunRef[]> {
  const snap = await db().collectionGroup("runs").where("status", "==", status).get();
  const all = snap.docs.map((d) => ({
    orgId: d.ref.parent.parent?.id ?? "", period: d.id as Period, status, sendAt: (d.get("sendAt") as Timestamp).toDate(),
  }));
  return orgIds === undefined ? all : all.filter((r) => orgIds.includes(r.orgId));
}

/** An org's billing settings and tenancies, outside a transaction. */
export async function billingOf(orgId: string): Promise<{ org: OrgDoc & BillingOrg; tenancies: (Tenancy & TenancyDocument)[] }> {
  const r = refs(orgId);
  const [orgSnap, tenancySnap] = await Promise.all([r.org.get(), r.tenancies.get()]);
  const org = orgSnap.data() as (OrgDoc & BillingOrg) | undefined;
  if (org === undefined) throw new Error(`no organisation ${orgId}`);
  return { org, tenancies: tenancySnap.docs.map((d) => asTenancy(d.id, d.data() as TenancyDocument)) };
}
