/**
 * The approval transaction (plan §6.3). One code path for the console (approveRun)
 * and the page. No I/O happens inside: Firestore may run the function more than
 * once, so everything it does is reads and buffered writes. PDFs follow the commit.
 */
import {
  type ApprovalEdits, type InvoiceDocument, type InvoiceTemplate, type Period, type RunStatus, type TenancyDocument,
  allocateNumbers, applyApprovalEdits, approvalOutcome, formatKina, invoiceSnapshot, templateFor, toea,
} from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { asDraft, type OrgDoc, refs } from "./runs.js";

export type ApproveOutcome = "approved" | "alreadyApproved" | "refused" | "noRun";

export interface ApproveRequest {
  /** A uid, "approval-link", or "tick" (plan §4, events). */
  readonly actor: string;
  readonly now: Date;
  /** The approval page's rent edits and ticks, applied in the same transaction. */
  readonly edits?: ApprovalEdits;
}

export async function approveRun(orgId: string, period: Period, req: ApproveRequest): Promise<ApproveOutcome> {
  const r = refs(orgId);
  return db().runTransaction(async (tx) => {
    const runSnap = await tx.get(r.run(period));
    if (!runSnap.exists) return "noRun";
    const outcome = approvalOutcome(runSnap.get("status") as RunStatus);
    if (outcome !== "approve") return outcome; // I4: approved or sent comes back unchanged

    const [orgSnap, counterSnap, invoiceSnap, templateSnap] = await Promise.all([tx.get(r.org), tx.get(r.counter), tx.get(r.invoicesOf(period)), tx.get(r.templates)]);
    const org = orgSnap.data() as OrgDoc;
    const templates = Object.fromEntries(templateSnap.docs.map((d) => [d.id, d.data() as InvoiceTemplate]));
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
    // How each invoice prints is resolved now and frozen with it: tenancy, property, org
    // default (docs/PLAN-TEMPLATES.md §3). At most 20 tenancies, so at most 20 properties.
    const propertyIds = [...new Set([...tenancyOf.values()].flatMap((t) => (t === undefined ? [] : [t.propertyId])))];
    const properties = await Promise.all(propertyIds.map((id) => tx.get(r.property(id))));
    const templateIdOf = new Map(properties.map((p) => [p.id, p.get("templateId") as string | undefined]));
    const templateOfTenancy = (id: string) => {
      const tenancy = tenancyOf.get(id);
      return templateFor({ tenancy, property: { templateId: tenancy === undefined ? undefined : templateIdOf.get(tenancy.propertyId) }, org }, templates);
    };

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
        snapshot: invoiceSnapshot(org, tenancyOf.get(doc.tenancyId) ?? { ...doc, propertyAddress: "" }, emailOf.get(doc.tenantId) ?? "", templateOfTenancy(doc.tenancyId)),
      });
    }
    // A tenancy with an issued invoice is ended, never deleted (plan §4); the rules read this flag.
    const billed = new Set(edited.filter((e) => numbered.has(e.id)).map((e) => e.draft.tenancyId));
    for (const id of billed) if (tenancyOf.get(id)?.invoiced === false) tx.update(r.tenancies.doc(id), { invoiced: true });
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

