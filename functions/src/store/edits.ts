/**
 * Editing a run before approval (plan §6.2): one invoice's rent, exclude/include,
 * and the explicit rebuild. Each is a transaction that re-checks the run is still
 * editable, then recomputes the run's total from its invoices - never adjusted
 * incrementally (plan §3.4).
 */
import {
  type InvoiceDocument, type Period, type RunStatus, type Toea,
  canExclude, canInclude, isEditable, periodLabel, redraftPlan, sendAt, withRent,
} from "@sasimem/core";
import { type DocumentReference, type Transaction, Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { asDraft, invoiceId, readBilling, refs } from "./runs.js";

/** A plain-English refusal; callables turn it into failed-precondition. */
export class Refused extends Error {}

const NOT_EDITABLE: Partial<Record<RunStatus, string>> = {
  approved: "is already approved, so its invoices cannot change",
  sent: "has already been sent, so its invoices cannot change",
  cancelled: "was cancelled",
};

function mustBeEditable(status: RunStatus | undefined, period: Period): asserts status is RunStatus {
  if (status === undefined) throw new Refused(`${periodLabel(period)} has no invoices yet.`);
  if (!isEditable(status)) throw new Refused(`${periodLabel(period)} ${NOT_EDITABLE[status] ?? "cannot change now"}.`);
}

export type InvoiceEdit = { readonly rentToea: Toea } | { readonly exclude: true } | { readonly include: true };

export async function editInvoice(orgId: string, id: string, edit: InvoiceEdit): Promise<void> {
  const r = refs(orgId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(r.invoice(id));
    if (!snap.exists) throw new Refused("That invoice no longer exists. Reload and try again.");
    const inv = snap.data() as InvoiceDocument;
    const period = inv.period;
    const run = await tx.get(r.run(period));
    const status = run.get("status") as RunStatus | undefined;
    mustBeEditable(status, period);
    const invoices = await tx.get(r.invoicesOf(period));

    let changed: Partial<InvoiceDocument>;
    if ("rentToea" in edit) changed = { ...withRent(asDraft(inv), edit.rentToea) };
    else if ("exclude" in edit) {
      if (!canExclude(status, inv.status)) throw new Refused("Only an invoice in this month's batch can be left out.");
      changed = { status: "excluded" };
    } else {
      if (!canInclude(status, inv.status)) throw new Refused("Only an invoice that was left out can be put back.");
      changed = { status: "draft" };
    }
    tx.update(r.invoice(id), changed);
    const after = invoices.docs.map((d) => (d.id === id ? { ...(d.data() as InvoiceDocument), ...changed } : (d.data() as InvoiceDocument)));
    updateRunTotals(tx, r.run(period), after);
  });
}

/** The run's total and count: its included (draft) invoices, recomputed from them. */
function updateRunTotals(tx: Transaction, run: DocumentReference, invoices: readonly Pick<InvoiceDocument, "status" | "totalToea">[], extra: Record<string, unknown> = {}): void {
  const included = invoices.filter((i) => i.status === "draft");
  tx.update(run, { totalToea: included.reduce((s, i) => s + i.totalToea, 0), invoiceCount: included.length, ...extra });
}

/** Redraft an editable run from current tenancy data (plan §3.4). Rent edits are discarded; exclusions kept. */
export async function rebuild(orgId: string, period: Period): Promise<void> {
  const r = refs(orgId);
  await db().runTransaction(async (tx) => {
    const run = await tx.get(r.run(period));
    mustBeEditable(run.get("status") as RunStatus | undefined, period);
    const [{ org, tenancies }, invoices] = await Promise.all([readBilling(tx, r), tx.get(r.invoicesOf(period))]);
    const existing = invoices.docs.map((d) => ({ id: d.id, ...(d.data() as InvoiceDocument) }));
    const plan = redraftPlan({ org, period, tenancies, existing });
    const byTenancy = new Map(tenancies.map((t) => [t.id, t]));
    const after = new Map(existing.map((i) => [i.id, i as Pick<InvoiceDocument, "status" | "totalToea">]));

    for (const draft of plan.create) {
      const t = byTenancy.get(draft.tenancyId);
      if (t === undefined) continue;
      const id = invoiceId(t.id, period);
      tx.create(r.invoice(id), {
        ...draft, tenantId: t.tenantId, tenantName: t.tenantName, unitLabel: t.unitLabel,
        status: "draft", numberSeq: null, number: null, snapshot: null, pdfPath: "",
        sentAt: null, paidAt: null, paidNote: "", remindedAt: null, remindersPaused: false,
      });
      after.set(id, { status: "draft", totalToea: draft.totalToea });
    }
    for (const { id, status, draft } of plan.rebuild) {
      const t = byTenancy.get(draft.tenancyId);
      tx.update(r.invoice(id), { ...draft, ...(t === undefined ? {} : { tenantName: t.tenantName, unitLabel: t.unitLabel }) });
      after.set(id, { status, totalToea: draft.totalToea });
    }
    for (const id of plan.remove) {
      tx.delete(r.invoice(id));
      after.delete(id);
    }
    updateRunTotals(tx, r.run(period), [...after.values()], { sendAt: Timestamp.fromDate(sendAt({ org, tenancies, period })) });
  });
}
