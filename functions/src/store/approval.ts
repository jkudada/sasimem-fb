/**
 * The approval transaction (plan §6.3). One code path for the console (approveRun)
 * and the page. No I/O happens inside: Firestore may run the function more than
 * once, so everything it does is reads and buffered writes. PDFs follow the commit.
 */
import {
  type ApprovalEdits, type DraftInvoice, type InvoiceDocument, type Period, type RunStatus, type TenancyDocument,
  allocateNumbers, applyApprovalEdits, approvalOutcome, formatKina, invoiceSnapshot, toea,
} from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { type OrgDoc, refs } from "./runs.js";

export type ApproveOutcome = "approved" | "alreadyApproved" | "refused" | "noRun";

export interface ApproveRequest {
  /** A uid, "approval-link", or "tick" (plan §4, events). */
  readonly actor: string;
  readonly now: Date;
  /** The approval page's rent edits and ticks, applied in the same transaction. */
  readonly edits?: ApprovalEdits;
}

const DRAFT_FIELDS = ["tenancyId", "period", "issueDate", "dueDate", "paymentReference", "lines", "subtotalToea", "gstToea", "totalToea", "documentTitle"] as const;
const asDraft = (inv: InvoiceDocument): DraftInvoice => Object.fromEntries(DRAFT_FIELDS.map((k) => [k, inv[k]])) as unknown as DraftInvoice;

export async function approveRun(orgId: string, period: Period, req: ApproveRequest): Promise<ApproveOutcome> {
  const r = refs(orgId);
  return db().runTransaction(async (tx) => {
    const runSnap = await tx.get(r.run(period));
    if (!runSnap.exists) return "noRun";
    const outcome = approvalOutcome(runSnap.get("status") as RunStatus);
    if (outcome !== "approve") return outcome; // I4: approved or sent comes back unchanged

    const [orgSnap, counterSnap, invoiceSnap] = await Promise.all([tx.get(r.org), tx.get(r.counter), tx.get(r.invoicesOf(period))]);
    const org = orgSnap.data() as OrgDoc;
    const editable = invoiceSnap.docs
      .map((d) => ({ id: d.id, doc: d.data() as InvoiceDocument }))
      .filter((i) => i.doc.status === "draft" || i.doc.status === "excluded");
    // What prints is frozen from the tenancy's and tenant's details as they are now.
    const [tenancies, tenants] = await Promise.all([
      Promise.all([...new Set(editable.map((i) => i.doc.tenancyId))].map((id) => tx.get(r.tenancies.doc(id)))),
      Promise.all([...new Set(editable.map((i) => i.doc.tenantId))].map((id) => tx.get(r.tenant(id)))),
    ]);
    const tenancyOf = new Map(tenancies.map((t) => [t.id, t.data() as TenancyDocument | undefined]));
    const emailOf = new Map(tenants.map((t) => [t.id, (t.get("email") as string | undefined) ?? ""]));

    // The page's edits first, so numbering sees what the landlord ticked.
    const edited = req.edits === undefined
      ? editable.map((i) => ({ id: i.id, status: i.doc.status, draft: asDraft(i.doc) }))
      : applyApprovalEdits(editable.map((i) => ({ id: i.id, status: i.doc.status, draft: asDraft(i.doc) })), req.edits);
    const byId = new Map(editable.map((i) => [i.id, i.doc]));

    const next = counterSnap.get("nextInvoiceNumber") as number;
    const allocation = allocateNumbers({
      prefix: org.invoicePrefix, nextNumber: next,
      invoices: edited.map((e) => ({ id: e.id, tenancyId: e.draft.tenancyId, tenantName: byId.get(e.id)?.tenantName ?? "", status: e.status })),
    });
    const numbered = new Map(allocation.numbers.map((n, i) => [n.invoiceId, { number: n.number, seq: next + i }]));
    const at = Timestamp.fromDate(req.now);

    let total = 0;
    for (const e of edited) {
      const doc = byId.get(e.id);
      if (doc === undefined) continue;
      const n = numbered.get(e.id);
      if (n === undefined) {
        tx.update(r.invoice(e.id), { ...e.draft, status: "excluded" }); // set aside, kept for the record
        continue;
      }
      total += e.draft.totalToea;
      tx.create(r.issued(n.seq), { invoiceId: e.id, at });
      tx.update(r.invoice(e.id), {
        ...e.draft,
        status: "approved", number: n.number, numberSeq: n.seq, pdfPath: "",
        snapshot: invoiceSnapshot(org, tenancyOf.get(doc.tenancyId) ?? { ...doc, propertyAddress: "" }, emailOf.get(doc.tenantId) ?? ""),
      });
    }
    tx.update(r.counter, { nextInvoiceNumber: allocation.nextNumber });
    tx.update(r.run(period), { status: "approved", approvedAt: at, totalToea: total, invoiceCount: numbered.size });
    const count = numbered.size;
    tx.create(r.events.doc(), {
      actor: req.actor, kind: "runApproved", at, target: `runs/${period}`,
      note: `${count} ${count === 1 ? "invoice" : "invoices"}, ${formatKina(toea(total))}`,
    });
    return "approved";
  });
}

