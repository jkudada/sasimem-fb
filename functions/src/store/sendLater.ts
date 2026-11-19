/**
 * A one-off draft scheduled to send later (docs/PLAN-GENERAL-INVOICING.md D7; G2d). The
 * schedule is its own server-written document, `sendLater/{draftId}`, so the draft stays the
 * owner's to edit and nothing is numbered until it goes. The tick sends it through the same
 * issueOneOff transaction as Send; that transaction drops the schedule.
 */
import {
  type CalendarDate, customerOf, draftOf, draftProblems, hasFeature, localDate, sendLaterAt, sendLaterLabel, sendLaterProblem,
} from "@sasimem/core";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { type OrgDoc, refs } from "./runs.js";

export const sendLaterRef = (orgId: string, draftId: string) => refs(orgId).org.collection("sendLater").doc(draftId);

export type ScheduleOutcome =
  | { readonly kind: "scheduled"; readonly sendAt: Date; readonly customerName: string; readonly label: string }
  | { readonly kind: "notFound" }
  | { readonly kind: "notEnabled" }
  | { readonly kind: "refused"; readonly message: string };

/** Check the draft as Send would, and the day; then record when it goes. Scheduling again moves it. */
export async function scheduleSend(orgId: string, draftId: string, sendOn: string, req: { readonly actor: string; readonly now: Date }): Promise<ScheduleOutcome> {
  const r = refs(orgId);
  return db().runTransaction(async (tx): Promise<ScheduleOutcome> => {
    const [orgSnap, draftSnap] = await Promise.all([tx.get(r.org), tx.get(r.org.collection("drafts").doc(draftId))]);
    if (!draftSnap.exists) return { kind: "notFound" };
    const org = orgSnap.data() as OrgDoc & { readonly sendHour: number; readonly modules?: unknown; readonly features?: unknown };
    if (!hasFeature(org, "oneOff")) return { kind: "notEnabled" };

    const draft = draftOf(draftSnap.data() ?? {});
    const customerSnap = draft.customerId === "" ? null : await tx.get(r.tenant(draft.customerId));
    const customer = customerSnap?.exists === true ? customerOf(customerSnap.data() ?? {}) : null;
    const problem = Object.values(draftProblems(draft, customer))[0] ?? sendLaterProblem(sendOn, localDate(req.now, org.timezone));
    if (problem !== null || customer === null) return { kind: "refused", message: problem ?? "Choose who this invoice is for." };

    const on = sendOn.trim() as CalendarDate;
    const sendAt = sendLaterAt(on, org);
    const label = sendLaterLabel(on, org.sendHour);
    const at = Timestamp.fromDate(req.now);
    tx.set(sendLaterRef(orgId, draftId), { sendOn: on, sendAt: Timestamp.fromDate(sendAt), customerName: customer.name, scheduledBy: req.actor, scheduledAt: at });
    tx.create(r.events.doc(), { actor: req.actor, kind: "invoiceScheduled", at, target: `drafts/${draftId}`, note: `${customer.name}, ${label}` });
    return { kind: "scheduled", sendAt, customerName: customer.name, label };
  });
}

/** Cancel the schedule; the draft stays. False when there was none. */
export async function cancelSend(orgId: string, draftId: string, req: { readonly actor: string; readonly now: Date }): Promise<boolean> {
  const r = refs(orgId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(sendLaterRef(orgId, draftId));
    if (!snap.exists) return false;
    tx.delete(snap.ref);
    tx.create(r.events.doc(), { actor: req.actor, kind: "invoiceUnscheduled", at: Timestamp.fromDate(req.now), target: `drafts/${draftId}`, note: "" });
    return true;
  });
}

export interface DueSchedule {
  readonly orgId: string;
  readonly draftId: string;
  readonly sendAt: Date;
  readonly scheduledBy: string;
  readonly customerName: string;
}

/** Schedules whose moment has come, across orgs (the collection-group index on sendLater.sendAt). One that could not go has no sendAt. */
export async function dueSchedules(now: Date, orgIds?: readonly string[]): Promise<DueSchedule[]> {
  const snap = await db().collectionGroup("sendLater").where("sendAt", "<=", Timestamp.fromDate(now)).get();
  const all = snap.docs.map((d) => ({
    orgId: d.ref.parent.parent?.id ?? "", draftId: d.id, sendAt: (d.get("sendAt") as Timestamp).toDate(),
    scheduledBy: d.get("scheduledBy") as string, customerName: d.get("customerName") as string,
  }));
  return orgIds === undefined ? all : all.filter((s) => orgIds.includes(s.orgId));
}

/**
 * The tick could not send it: keep the schedule with the problem, and no moment, so it is
 * not tried again. True only for the tick that recorded it, which alone emails the owner.
 */
export async function recordNotSent(s: DueSchedule, problem: string, now: Date): Promise<boolean> {
  const ref = sendLaterRef(s.orgId, s.draftId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const at = snap.get("sendAt") as Timestamp | undefined;
    if (at === undefined || at.toMillis() !== s.sendAt.getTime()) return false;
    tx.update(ref, { sendAt: FieldValue.delete(), problem, failedAt: Timestamp.fromDate(now) });
    return true;
  });
}

/** A deleted draft's schedule: nothing to send. */
export async function dropSchedule(s: DueSchedule): Promise<void> {
  await sendLaterRef(s.orgId, s.draftId).delete();
}
