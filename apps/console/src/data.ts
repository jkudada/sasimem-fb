/**
 * The console's reads (PLAN-SUBSCRIBERS §7), loaded after sign-in. Read-only: every
 * change an operator makes goes through an audited callable (S3), and the rules refuse
 * any direct write. Firestore Lite: nothing here needs live updates.
 */
import type { SubscriptionFields } from "@sasimem/core";
import {
  collection, type DocumentData, doc, getDoc, getDocs, getFirestore, query, Timestamp, where,
} from "firebase/firestore/lite";
import { startAppCheck } from "./appcheck.js";
import { app } from "./firebase.js";
import type {
  EmailSummary, InvoiceSummary, Note, OperatorEvent, OrgDetail, OrgSummary, Payment, RunSummary, SubscriberDetail, SubscriberInput, TickBeat,
} from "./types.js";

startAppCheck(app, import.meta.env["VITE_RECAPTCHA_SITE_KEY"]);
const db = getFirestore(app);

const EMAIL_DAYS = 30;
const dateOf = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

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

export interface ConsoleData {
  subscribers(): Promise<SubscriberInput[]>;
  subscriber(orgId: string): Promise<SubscriberDetail | null>;
  tick(): Promise<TickBeat | null>;
}

export const consoleData: ConsoleData = {
  async subscribers() {
    const [orgs, subs] = await Promise.all([getDocs(collection(db, "orgs")), getDocs(collection(db, "subscriptions"))]);
    const subOf = new Map(subs.docs.map((d) => [d.id, d.data() as SubscriptionFields]));
    // One org's runs and last 30 days of email each: a few small reads per subscriber.
    return Promise.all(orgs.docs.map(async (o) => ({
      org: orgSummary(o.id, o.data()), sub: subOf.get(o.id) ?? null,
      runs: await runsOf(o.id), emails: await recentEmails(o.id),
    })));
  },

  async subscriber(orgId) {
    const orgDoc = await getDoc(doc(db, `orgs/${orgId}`));
    if (!orgDoc.exists()) return null;
    const [sub, payments, notes, events, runs, emails] = await Promise.all([
      getDoc(doc(db, `subscriptions/${orgId}`)),
      getDocs(collection(db, `subscriptions/${orgId}/payments`)),
      getDocs(collection(db, `subscriptions/${orgId}/notes`)),
      getDocs(query(collection(db, "operatorEvents"), where("orgId", "==", orgId))),
      runsOf(orgId),
      recentEmails(orgId),
    ]);
    const latest = runs[0];
    const invoices = latest === undefined ? [] : (await getDocs(query(collection(db, `orgs/${orgId}/invoices`), where("period", "==", latest.period)))).docs;
    return {
      org: orgDetail(orgId, orgDoc.data()),
      sub: sub.exists() ? (sub.data() as SubscriptionFields) : null,
      payments: payments.docs.map((d): Payment => ({ id: d.id, amountToea: num(d.get("amountToea")), receivedOn: d.get("receivedOn"), bankReference: str(d.get("bankReference")) }))
        .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn)),
      notes: notes.docs.map((d): Note => ({ id: d.id, text: str(d.get("text")), by: str(d.get("by")), at: dateOf(d.get("at")) ?? new Date(0) }))
        .sort((a, b) => b.at.getTime() - a.at.getTime()),
      events: events.docs.map((d): OperatorEvent => ({ id: d.id, kind: str(d.get("kind")), actor: str(d.get("actor")), at: dateOf(d.get("at")) ?? new Date(0) }))
        .sort((a, b) => b.at.getTime() - a.at.getTime()),
      runs, emails,
      invoices: invoices.map((d): InvoiceSummary => ({
        id: d.id, number: typeof d.get("number") === "string" ? d.get("number") : null,
        tenantName: str(d.get("snapshot.tenantName")) || str(d.get("tenantName")), status: str(d.get("status")), totalToea: num(d.get("totalToea")),
      })).sort((a, b) => a.tenantName.localeCompare(b.tenantName)),
    };
  },

  async tick() {
    const beat = await getDoc(doc(db, "system/tick"));
    const at = dateOf(beat.get("lastSuccessAt"));
    return at === null ? null : { lastSuccessAt: at, tally: (beat.get("tally") ?? {}) as Record<string, number> };
  },
};
