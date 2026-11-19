/**
 * The console's reads (PLAN-SUBSCRIBERS §7), loaded after sign-in. Read-only but for the
 * person's own name and last-seen time: every other change goes through an audited
 * callable (callables.ts), and the rules refuse any direct write. Each read asks only for
 * what the reader's role may see (PLAN-ADMIN-DASHBOARD §4), since rules are not filters.
 * Firestore Lite: nothing here needs live updates.
 */
import { auditScope, can, type ConsoleSettings, type PlanId, settingsFrom, type SubscriptionFields, TEAM_ROLES } from "@sasimem/core";
import {
  collection, type DocumentData, doc, getDoc, getDocs, getFirestore, query, type Query, serverTimestamp, Timestamp, updateDoc, where,
} from "firebase/firestore/lite";
import { startAppCheck } from "./appcheck.js";
import { app } from "./firebase.js";
import type {
  Access, EmailSummary, OwnRecord, Invite, InvoiceSummary, Note, OperatorEvent, OrgDetail, OrgSummary, Payment, PaymentRow, RunSummary, SubscriberDetail, SubscriberInput, TickBeat,
} from "./types.js";

startAppCheck(app, import.meta.env["VITE_RECAPTCHA_SITE_KEY"]);
const db = getFirestore(app);

const EMAIL_DAYS = 30;
const dateOf = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

/**
 * A customer as someone who may not see names sees them: an ID, not a name or contact.
 * A3 replaces this with the stats job's codes (C-0042).
 */
export const unnamed = (id: string): OrgSummary => ({ id, name: `Customer ${id.slice(0, 6)}`, email: "", createdAt: null });

const orgSummary = (id: string, d: DocumentData): OrgSummary => ({ id, name: str(d["name"]), email: str(d["email"]), createdAt: dateOf(d["createdAt"]) });
const orgDetail = (id: string, d: DocumentData): OrgDetail => ({
  ...orgSummary(id, d), address: str(d["address"]), gstRegistered: d["gstRegistered"] === true, gstNumber: str(d["gstNumber"]), timezone: str(d["timezone"]),
});
const run = (period: string, d: DocumentData): RunSummary => ({
  period, status: d["status"], approvedAt: dateOf(d["approvedAt"]), invoiceCount: num(d["invoiceCount"]), totalToea: num(d["totalToea"]),
});
const email = (id: string, d: DocumentData): EmailSummary => ({
  id, kind: str(d["kind"]), to: str(d["to"]), subject: str(d["subject"]), status: d["status"] === "failed" ? "failed" : "sent",
  sentAt: dateOf(d["sentAt"]) ?? new Date(0), error: typeof d["error"] === "string" ? d["error"] : null,
});

async function runsOf(orgId: string): Promise<RunSummary[]> {
  const snap = await getDocs(collection(db, `orgs/${orgId}/runs`));
  return snap.docs.map((d) => run(d.id, d.data())).sort((a, b) => b.period.localeCompare(a.period));
}

async function recentEmails(orgId: string): Promise<EmailSummary[]> {
  const since = Timestamp.fromMillis(Date.now() - EMAIL_DAYS * 86_400_000);
  const snap = await getDocs(query(collection(db, `orgs/${orgId}/emails`), where("sentAt", ">=", since)));
  return snap.docs.map((d) => email(d.id, d.data())).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
}

const event = (id: string, d: DocumentData): OperatorEvent => {
  const before = (d["before"] ?? {}) as Record<string, unknown>;
  const after = (d["after"] ?? {}) as Record<string, unknown>;
  return {
    id, kind: str(d["kind"]), actor: str(d["actor"]), actorEmail: str(d["actorEmail"]), at: dateOf(d["at"]) ?? new Date(0),
    changes: Object.keys(after).sort().map((field) => ({ field, before: before[field] ?? null, after: after[field] })),
  };
};

const invite = (email: string, d: DocumentData): Invite => ({
  email, planId: typeof d["planId"] === "string" ? (d["planId"] as PlanId) : null,
  trialDays: typeof d["trialDays"] === "number" ? d["trialDays"] : null,
  expiresAt: dateOf(d["expiresAt"]), invitedAt: dateOf(d["invitedAt"]),
  used: d["usedBy"] != null, sendCount: num(d["sendCount"]), lastError: typeof d["lastError"] === "string" ? d["lastError"] : null,
});

export interface ConsoleData {
  subscribers(access: Access): Promise<SubscriberInput[]>;
  invites(): Promise<Invite[]>;
  subscriber(orgId: string, access: Access): Promise<SubscriberDetail | null>;
  tick(): Promise<TickBeat | null>;
  /** The daily subscription tick's last success (S4). */
  subscriptionTick(): Promise<TickBeat | null>;
  /** Every payment recorded, with its org (S5, the Billing page). */
  payments(access: Access): Promise<PaymentRow[]>;
  /** The console's settings (PLAN-ADMIN-DASHBOARD §5); the defaults where none are stored. */
  settings(): Promise<ConsoleSettings>;
  /** The reader's own staff record. */
  own(uid: string): Promise<OwnRecord | null>;
  /** Record that the reader was here now, and their name if given. */
  seen(uid: string, displayName?: string): Promise<void>;
}

/** Names by org ID, or none for a reader who may not see them. */
async function namesFor(access: Access): Promise<Map<string, DocumentData>> {
  if (!can(access.role, "names", access.settings)) return new Map();
  return new Map((await getDocs(collection(db, "orgs"))).docs.map((o) => [o.id, o.data()]));
}

/** The audit entries about one org that the reader may read (rules are not filters). */
function eventsQuery(orgId: string, access: Access): Query | null {
  const about = collection(db, "operatorEvents");
  switch (auditScope(access.role)) {
    case "all": return query(about, where("orgId", "==", orgId));
    case "team": return query(about, where("orgId", "==", orgId), where("actorRole", "in", [...TEAM_ROLES]));
    case "own": return query(about, where("orgId", "==", orgId), where("actor", "==", access.uid));
    case "none": return null;
  }
}

const none = async <T>(): Promise<T[]> => [];

export const consoleData: ConsoleData = {
  async subscribers(access) {
    const records = can(access.role, "orgRecords", access.settings);
    const [names, subs] = await Promise.all([namesFor(access), getDocs(collection(db, "subscriptions"))]);
    const subOf = new Map(subs.docs.map((d) => [d.id, d.data() as SubscriptionFields]));
    const ids = names.size > 0 ? [...names.keys()] : [...subOf.keys()];
    // One org's runs and last 30 days of email each, for those who may read them.
    return Promise.all(ids.map(async (id) => {
      const named = names.get(id);
      return {
        org: named === undefined ? unnamed(id) : orgSummary(id, named), sub: subOf.get(id) ?? null,
        runs: records ? await runsOf(id) : [], emails: records ? await recentEmails(id) : [],
      };
    }));
  },

  async subscriber(orgId, access) {
    const may = (c: Parameters<typeof can>[1]) => can(access.role, c, access.settings);
    const named = may("names") ? await getDoc(doc(db, `orgs/${orgId}`)) : null;
    const sub = await getDoc(doc(db, `subscriptions/${orgId}`));
    if (named === null ? !sub.exists() : !named.exists()) return null;
    const records = may("orgRecords");
    const eq = eventsQuery(orgId, access);
    const [payments, notes, events, runs, emails] = await Promise.all([
      may("billing") ? getDocs(collection(db, `subscriptions/${orgId}/payments`)).then((s) => s.docs) : none<never>(),
      may("notes") ? getDocs(collection(db, `subscriptions/${orgId}/notes`)).then((s) => s.docs) : none<never>(),
      eq === null ? none<never>() : getDocs(eq).then((s) => s.docs),
      records ? runsOf(orgId) : none<RunSummary>(),
      records ? recentEmails(orgId) : none<EmailSummary>(),
    ]);
    const latest = runs[0];
    const invoices = latest === undefined ? [] : (await getDocs(query(collection(db, `orgs/${orgId}/invoices`), where("period", "==", latest.period)))).docs;
    return {
      org: named === null ? { ...unnamed(orgId), address: "", gstRegistered: false, gstNumber: "", timezone: "" } : orgDetail(orgId, named.data() ?? {}),
      sub: sub.exists() ? (sub.data() as SubscriptionFields) : null,
      payments: payments.map((d): Payment => ({ id: d.id, amountToea: num(d.get("amountToea")), receivedOn: d.get("receivedOn"), bankReference: str(d.get("bankReference")) }))
        .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn)),
      notes: notes.map((d): Note => ({ id: d.id, text: str(d.get("text")), by: str(d.get("byEmail")) || str(d.get("by")), at: dateOf(d.get("at")) ?? new Date(0) }))
        .sort((a, b) => b.at.getTime() - a.at.getTime()),
      events: events.map((d) => event(d.id, d.data()))
        .sort((a, b) => b.at.getTime() - a.at.getTime()),
      runs, emails,
      invoices: invoices.map((d): InvoiceSummary => ({
        id: d.id, number: typeof d.get("number") === "string" ? d.get("number") : null,
        tenantName: str(d.get("snapshot.tenantName")) || str(d.get("tenantName")), status: str(d.get("status")), totalToea: num(d.get("totalToea")),
      })).sort((a, b) => a.tenantName.localeCompare(b.tenantName)),
    };
  },

  async invites() {
    const snap = await getDocs(collection(db, "signupInvites"));
    return snap.docs.map((d) => invite(d.id, d.data())).sort((a, b) => (b.invitedAt?.getTime() ?? 0) - (a.invitedAt?.getTime() ?? 0));
  },

  async payments(access) {
    const [names, subs] = await Promise.all([namesFor(access), getDocs(collection(db, "subscriptions"))]);
    const nameOf = new Map(subs.docs.map((s) => [s.id, names.has(s.id) ? str(names.get(s.id)?.["name"]) : unnamed(s.id).name]));
    // One small read per subscriber, as the Subscribers list does.
    const each = await Promise.all(subs.docs.map(async (sub) => (await getDocs(collection(db, `subscriptions/${sub.id}/payments`))).docs.map((d): PaymentRow => ({
      id: d.id, orgId: sub.id, orgName: nameOf.get(sub.id) ?? sub.id, subscriptionReference: typeof sub.get("paymentReference") === "string" ? sub.get("paymentReference") : null,
      amountToea: num(d.get("amountToea")), receivedOn: d.get("receivedOn"), bankReference: str(d.get("bankReference")),
      coversFrom: d.get("coversFrom") ?? null, coversTo: d.get("coversTo") ?? null,
    }))));
    return each.flat();
  },

  async settings() {
    return settingsFrom((await getDoc(doc(db, "console/settings"))).data());
  },

  async own(uid) {
    const me = await getDoc(doc(db, `staff/${uid}`));
    return me.exists() ? { displayName: str(me.get("displayName")), lastSeenAt: dateOf(me.get("lastSeenAt")) } : null;
  },

  async seen(uid, displayName) {
    // The rules let a person set only these two fields of their own record, lastSeenAt to now.
    await updateDoc(doc(db, `staff/${uid}`), { lastSeenAt: serverTimestamp(), ...(displayName === undefined ? {} : { displayName }) });
  },

  tick: () => heartbeat("system/tick"),
  subscriptionTick: () => heartbeat("system/subscriptionTick"),
};

async function heartbeat(path: string): Promise<TickBeat | null> {
  const beat = await getDoc(doc(db, path));
  const at = dateOf(beat.get("lastSuccessAt"));
  return at === null ? null : { lastSuccessAt: at, tally: (beat.get("tally") ?? {}) as Record<string, number> };
}
