/**
 * The setup screens' Firebase side (step 3), loaded only after sign-in. Firestore
 * Lite, as in data.ts: one read of everything when the app opens and after each
 * save, no live listeners. A landlord has 1-20 tenancies, so that is a handful of
 * small documents. Storage loads only when Settings shows or changes the logo.
 */
import {
  type BankDetails, type InvoiceDocument, type Item, type OneOffDraft, type SubscriptionFields, type InvoiceTemplate, type Period, type PropertyInput, type RunStatus, type TenancyDocument, type TenantInput, type Toea,
  arrears, draftOf, hasFeature, logoExtension, sourceOf,
} from "@sasimem/core";
import {
  type Timestamp, addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore/lite";
import { httpsCallable } from "firebase/functions";
import { app, usingEmulators } from "./firebase.js";
import { db, functions } from "./data.js";
import type { CreditNoteRow, CreditableRow, EmailEntry, Month, MonthSummary, Numbering, OneOffInvoice, Org, Outcome, OwedInvoice, PaymentRow, ProfileEdit, Setup, SetupStore, SubscriptionPayment, TenancyEdit, WithId } from "./setup.js";

const OFFLINE = "You need a connection to do this. Check your signal and try again.";

/** What has been paid and credited on an invoice (G2b, G2c), for the screens; absent fields stay absent. */
const moneyOf = (i: InvoiceDocument) => ({
  ...(i.amountPaidToea === undefined ? {} : { amountPaidToea: i.amountPaidToea }),
  ...(i.creditedToea === undefined ? {} : { creditedToea: i.creditedToea }),
  ...(i.creditNotedToea === undefined ? {} : { creditNotedToea: i.creditNotedToea }),
});
const COULD_NOT_SAVE = "That could not be saved. Please try again.";

/** Turn a thrown write into a plain message, or null on success. */
async function attempt(act: () => Promise<unknown>, failure = COULD_NOT_SAVE): Promise<string | null> {
  try {
    await act();
    return null;
  } catch {
    return navigator.onLine ? failure : OFFLINE;
  }
}

async function storage() {
  const { connectStorageEmulator, getStorage } = await import("firebase/storage");
  const s = getStorage(app);
  if (usingEmulators && !connected) {
    connectStorageEmulator(s, "127.0.0.1", 9199);
    connected = true;
  }
  return s;
}
let connected = false;

const withIds = <T,>(snap: Awaited<ReturnType<typeof getDocs>>): WithId<T>[] =>
  snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));

/** Call a run callable; its own message is plain English, a dropped connection gets ours. */
async function call(name: string, data: Record<string, unknown>, success: (reply: { message?: string }) => string): Promise<Outcome> {
  try {
    const reply = (await httpsCallable<Record<string, unknown>, { message?: string }>(functions, name)(data)).data;
    return { ok: true, message: success(reply) };
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
    const offline = !navigator.onLine || code === "functions/unavailable" || code === "functions/deadline-exceeded";
    return { ok: false, message: !offline && code.startsWith("functions/") && e instanceof Error ? e.message : OFFLINE };
  }
}

/** Hand the browser a file to save. A download, not a new tab: a tab opened after a network call is often blocked on phones. */
function save(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const fromBase64 = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function setupStore(orgId: string): SetupStore {
  const org = `orgs/${orgId}`;
  const ref = (path: string) => doc(db, `${org}/${path}`);

  /** Upload a logo under a new name each time, so a browser never shows a cached old one as the new. Old files stay (plan §5). */
  const upload = async (extension: string, data: Blob, contentType: string): Promise<string> => {
    const { ref: fileRef, uploadBytes } = await import("firebase/storage");
    const path = `logos/${orgId}/${Date.now()}.${extension}`;
    await uploadBytes(fileRef(await storage(), path), data, { contentType });
    return path;
  };

  return {
    async load(): Promise<Setup> {
      // The subscription and Sasimem's bank details only add a banner and a limit message:
      // if either cannot be read, the app still opens without them.
      const optional = <T,>(path: string) => getDoc(doc(db, path)).then((d) => (d.exists() ? (d.data() as T) : null), () => null);
      const [o, properties, tenants, tenancies, templates, subscription, bank] = await Promise.all([
        getDoc(doc(db, org)),
        getDocs(collection(db, `${org}/properties`)),
        getDocs(collection(db, `${org}/tenants`)),
        getDocs(collection(db, `${org}/tenancies`)),
        getDocs(collection(db, `${org}/templates`)),
        optional<SubscriptionFields>(`subscriptions/${orgId}`),
        optional<BankDetails>("sasimem/billing"),
      ]);
      const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
      const orgData = o.data() as Org;
      // The price list only for orgs with one-off invoices (G2a): Rentals-only orgs read nothing more.
      const items = hasFeature(orgData, "oneOff") ? withIds<Item>(await getDocs(collection(db, `${org}/items`))).sort(byName) : [];
      return {
        org: orgData,
        properties: withIds<PropertyInput>(properties).sort((a, b) => a.address.localeCompare(b.address)),
        tenants: withIds<TenantInput>(tenants).sort(byName),
        tenancies: withIds<TenancyDocument>(tenancies),
        templates: withIds<InvoiceTemplate>(templates).sort(byName),
        subscription, bank, items,
      };
    },

    saveProperty: (id, property) => attempt(() => (id === null ? addDoc(collection(db, `${org}/properties`), property) : setDoc(ref(`properties/${id}`), property))),
    deleteProperty: (id) => attempt(() => deleteDoc(ref(`properties/${id}`))),
    saveTenant: (id, tenant) => attempt(() => (id === null ? addDoc(collection(db, `${org}/tenants`), tenant) : setDoc(ref(`tenants/${id}`), tenant, { merge: true }))), // merge: keep the customer details this form does not show (G1b)
    deleteTenant: (id) => attempt(() => deleteDoc(ref(`tenants/${id}`))),
    createTenancy: (tenancy) => attempt(() => addDoc(collection(db, `${org}/tenancies`), tenancy)),
    updateTenancy: (id, { templateId, ...edit }: TenancyEdit) =>
      attempt(() => updateDoc(ref(`tenancies/${id}`), { ...edit, templateId: templateId ?? deleteField() })),
    deleteTenancy: (id) => attempt(() => deleteDoc(ref(`tenancies/${id}`))),
    saveProfile: (profile: ProfileEdit) => attempt(() => updateDoc(doc(db, org), { ...profile })),

    uploadLogo: (file) => attempt(async () => {
      const path = await upload(logoExtension(file.type), file, file.type);
      await updateDoc(doc(db, org), { logoPath: path, logoDesign: deleteField() });
    }, "The logo could not be uploaded. Please try again."),

    saveLogoDesign: (design, png) => attempt(async () => {
      const path = await upload("png", png, "image/png");
      await updateDoc(doc(db, org), { logoPath: path, logoDesign: { ...design } });
    }, "The logo could not be saved. Please try again."),

    saveTemplate: (id, template, makeDefault) => attempt(async () => {
      const batch = writeBatch(db);
      const t = id === null ? doc(collection(db, `${org}/templates`)) : ref(`templates/${id}`);
      batch.set(t, { ...template });
      if (makeDefault) batch.update(doc(db, org), { defaultTemplateId: t.id });
      await batch.commit();
    }),
    deleteTemplate: (id) => attempt(() => deleteDoc(ref(`templates/${id}`))),
    setDefaultTemplate: (id) => attempt(() => updateDoc(doc(db, org), { defaultTemplateId: id ?? deleteField() })),

    async previewTemplate(template) {
      let file: { filename: string; base64: string } | undefined;
      const outcome = await call("previewInvoicePdf", { orgId, template: { ...template } }, (r) => {
        file = r as unknown as { filename: string; base64: string };
        return "The sample PDF has downloaded. Open it to see your template.";
      });
      if (file !== undefined) save(file.filename, new Blob([fromBase64(file.base64)], { type: "application/pdf" }));
      return outcome;
    },

    removeLogo: () => attempt(() => updateDoc(doc(db, org), { logoPath: deleteField(), logoDesign: deleteField() })),

    async logoUrl(path) {
      try {
        const { getDownloadURL, ref: fileRef } = await import("firebase/storage");
        return await getDownloadURL(fileRef(await storage(), path));
      } catch {
        return null;
      }
    },

    async numbering(): Promise<Numbering | string> {
      try {
        return (await httpsCallable<{ orgId: string }, Numbering>(functions, "getNumbering")({ orgId })).data;
      } catch {
        return OFFLINE;
      }
    },

    async month(period: Period): Promise<Month | null | string> {
      try {
        const [run, invoices, emails] = await Promise.all([
          getDoc(ref(`runs/${period}`)),
          getDocs(query(collection(db, `${org}/invoices`), where("period", "==", period))),
          getDocs(query(collection(db, `${org}/emails`), where("runPeriod", "==", period))),
        ]);
        if (!run.exists()) return null;
        const r = run.data();
        return {
          period,
          status: r["status"] as RunStatus,
          sendAt: (r["sendAt"] as Timestamp).toDate(),
          totalToea: r["totalToea"] as Toea,
          invoiceCount: r["invoiceCount"] as number,
          // The Rentals month shows rent invoices only: a one-off records its month too (G2a).
          invoices: invoices.docs
            .filter((d) => sourceOf(d.data() as InvoiceDocument).kind === "rent")
            .map((d) => {
              const i = d.data() as InvoiceDocument;
              const rent = i.lines.find((l) => l.kind === "rent");
              return {
                id: d.id, tenancyId: i.tenancyId, ...(i.snapshot?.template === undefined ? {} : { templateName: i.snapshot.template.name }), tenantName: i.tenantName, unitLabel: i.unitLabel, status: i.status, rentToea: (rent?.amountToea ?? 0) as Toea, totalToea: i.totalToea, number: i.number,
                dueDate: i.dueDate, paidNote: i.paidNote, remindersPaused: i.remindersPaused,
                ...moneyOf(i),
              };
            })
            .sort((a, b) => (a.number !== null && b.number !== null ? a.number.localeCompare(b.number) : a.tenantName.localeCompare(b.tenantName))),
          emails: emails.docs
            .map((d) => {
              const e = d.data();
              return { id: d.id, kind: e["kind"], to: e["to"], subject: e["subject"], status: e["status"], sentAt: (e["sentAt"] as Timestamp).toDate(), error: e["error"] ?? null } as EmailEntry;
            })
            .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()),
        };
      } catch {
        return OFFLINE;
      }
    },

    draftNow: (period) => call("draftNow", { orgId, period }, (r) => r.message ?? ""),
    setRent: (invoiceId, rentToea) => call("setRent", { orgId, invoiceId, rentToea }, () => "Rent saved."),
    exclude: (invoiceId) => call("exclude", { orgId, invoiceId }, () => ""),
    include: (invoiceId) => call("include", { orgId, invoiceId }, () => ""),
    rebuildRun: (period) => call("rebuildRun", { orgId, period }, () => "Rebuilt from your tenancy details."),
    approveRun: (period) => call("approveRun", { orgId, period }, (r) => r.message ?? "Approved."),

    async months(): Promise<readonly MonthSummary[] | string> {
      try {
        const runs = await getDocs(collection(db, `${org}/runs`));
        return runs.docs
          .map((d) => ({ period: d.id as Period, status: d.get("status") as RunStatus, invoiceCount: d.get("invoiceCount") as number, totalToea: d.get("totalToea") as Toea }))
          .sort((a, b) => b.period.localeCompare(a.period));
      } catch {
        return OFFLINE;
      }
    },

    async owed() {
      try {
        const sent = await getDocs(query(collection(db, `${org}/invoices`), where("status", "==", "sent")));
        return arrears(sent.docs.map((d): OwedInvoice => {
          const i = d.data() as InvoiceDocument;
          return {
            id: d.id, tenantId: i.tenantId, tenantName: i.snapshot?.tenantName ?? i.tenantName, number: i.number, period: i.period, status: i.status, dueDate: i.dueDate, totalToea: i.totalToea,
            ...moneyOf(i),
          };
        }));
      } catch {
        return OFFLINE;
      }
    },

    markPaid: (invoiceId, note) => call("markPaid", { orgId, invoiceId, note }, () => "Marked paid."),
    markUnpaid: (invoiceId) => call("markUnpaid", { orgId, invoiceId }, () => "Marked not paid."),
    pauseReminders: (invoiceId, paused) => call("pauseReminders", { orgId, invoiceId, paused }, () => (paused ? "Reminders paused." : "Reminders resumed.")),
    voidInvoice: (invoiceId, reason) => call("voidInvoice", { orgId, invoiceId, reason }, () => "Voided."),
    resendInvoice: (invoiceId) => call("resendInvoice", { orgId, invoiceId }, (r) => r.message ?? "Emailed again."),

    async openPdf(invoiceId) {
      let file: { filename: string; base64: string } | undefined;
      const outcome = await call("invoicePdf", { orgId, invoiceId }, (r) => {
        file = r as unknown as { filename: string; base64: string };
        return "";
      });
      if (file !== undefined) save(file.filename, new Blob([fromBase64(file.base64)], { type: "application/pdf" }));
      return outcome;
    },

    async exportCsv(from, to) {
      let file: { filename: string; csv: string } | undefined;
      const outcome = await call("exportCsv", { orgId, from, to }, (r) => {
        file = r as unknown as { filename: string; csv: string };
        return "";
      });
      if (file !== undefined) save(file.filename, new Blob([file.csv], { type: "text/csv;charset=utf-8" }));
      return outcome;
    },

    async subscriptionPayments() {
      try {
        const snap = await getDocs(collection(db, `subscriptions/${orgId}/payments`));
        return snap.docs
          .map((d): SubscriptionPayment => ({ ...(d.data() as Omit<SubscriptionPayment, "id">), id: d.id }))
          .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
      } catch {
        return OFFLINE;
      }
    },

    askToChangePlan: (planId, interval, message) => call("requestPlanChange", { orgId, planId, interval, message }, (r) => r.message ?? "Sent."),

    async exportEverything() {
      try {
        const { url } = (await httpsCallable<{ orgId: string }, { url: string; filename: string }>(functions, "exportEverything", { timeout: 300_000 })({ orgId })).data;
        // A plain download from our own origin (/x/**): the page stays where it is.
        const a = Object.assign(document.createElement("a"), { href: url });
        document.body.append(a);
        a.click();
        a.remove();
        return { ok: true, message: "Your export is downloading.", url };
      } catch (e) {
        const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
        const offline = !navigator.onLine || code === "functions/unavailable" || code === "functions/deadline-exceeded";
        return { ok: false, message: !offline && code.startsWith("functions/") && e instanceof Error ? e.message : OFFLINE };
      }
    },

    cancelSubscription: () => call("cancelSubscription", { orgId }, () => "Your subscription is cancelled."),

    saveItem: (id, item) => attempt(() => (id === null ? addDoc(collection(db, `${org}/items`), { ...item }) : setDoc(ref(`items/${id}`), { ...item }))),
    deleteItem: (id) => attempt(() => deleteDoc(ref(`items/${id}`))),

    async oneOffs() {
      try {
        const [drafts, invoices] = await Promise.all([
          getDocs(collection(db, `${org}/drafts`)),
          getDocs(query(collection(db, `${org}/invoices`), where("source.kind", "==", "oneOff"))),
        ]);
        return {
          drafts: drafts.docs.map((d) => ({ ...draftOf(d.data()), id: d.id })),
          invoices: invoices.docs
            .map((d): OneOffInvoice => {
              const i = d.data() as InvoiceDocument;
              return {
                id: d.id, number: i.number ?? "", customerName: i.snapshot?.tenantName ?? i.tenantName, issueDate: i.issueDate, dueDate: i.dueDate, totalToea: i.totalToea, status: i.status,
                ...moneyOf(i),
              };
            })
            .sort((a, b) => b.number.localeCompare(a.number)),
        };
      } catch {
        return OFFLINE;
      }
    },

    async draft(id) {
      try {
        const d = await getDoc(ref(`drafts/${id}`));
        return d.exists() ? draftOf(d.data()) : null;
      } catch {
        return OFFLINE;
      }
    },

    async saveDraft(id, draft: OneOffDraft) {
      const target = id === null ? doc(collection(db, `${org}/drafts`)) : ref(`drafts/${id}`);
      const problem = await attempt(() => setDoc(target, { ...draft, lines: draft.lines.map((l) => ({ ...l })) }));
      return problem === null ? { id: target.id } : { problem };
    },
    deleteDraft: (id) => attempt(() => deleteDoc(ref(`drafts/${id}`))),
    issueInvoice: (draftId) => call("issueInvoice", { orgId, draftId }, (r) => r.message ?? "Sent."),

    async payments() {
      try {
        const snap = await getDocs(collection(db, `${org}/payments`));
        return snap.docs
          .map((d) => {
            const p = d.data();
            return {
              id: d.id, receiptNumber: p["receiptNumber"], customerId: p["customerId"], customerName: p["customerName"], receivedOn: p["receivedOn"],
              amountToea: p["amountToea"], method: p["method"], reference: p["reference"], creditToea: p["creditToea"], status: p["status"], undoReason: p["undoReason"] ?? "",
              allocations: (p["allocations"] as { number: string; amountToea: Toea }[]).map((a) => ({ number: a.number, amountToea: a.amountToea })),
              ...(p["creditUsedToea"] === undefined ? {} : { creditUsedToea: p["creditUsedToea"] }),
              // When it was recorded: a payment of credit only has no receipt number to sort by (G2c).
              at: (p["recordedAt"] as Timestamp | undefined)?.toMillis() ?? 0,
            };
          })
          .sort((a, b) => b.at - a.at)
          .map(({ at: _at, ...row }) => row as PaymentRow);
      } catch {
        return OFFLINE;
      }
    },
    recordPayment: (paymentId, payment, emailReceipt) =>
      call("recordPayment", { orgId, paymentId, ...payment, allocations: payment.allocations.map((a) => ({ ...a })), emailReceipt }, (r) => r.message ?? "Recorded."),
    undoPayment: (paymentId, reason) => call("undoPayment", { orgId, paymentId, reason }, (r) => r.message ?? "Undone."),
    resendReceipt: (paymentId) => call("resendReceipt", { orgId, paymentId }, (r) => r.message ?? "Emailed again."),

    async credits() {
      try {
        const snap = await getDocs(collection(db, `${org}/credits`));
        return new Map(snap.docs.map((d) => [d.id, d.get("balanceToea") as number] as const).filter(([, b]) => b > 0));
      } catch {
        return OFFLINE;
      }
    },

    async creditNotes() {
      try {
        const snap = await getDocs(collection(db, `${org}/creditNotes`));
        return snap.docs
          .map((d) => {
            const c = d.data();
            const row: CreditNoteRow = {
              id: d.id, number: c["number"], invoiceNumber: c["invoiceNumber"], customerName: c["customerName"], issueDate: c["issueDate"], reason: c["reason"],
              totalToea: c["totalToea"], appliedToea: c["appliedToea"], creditToea: c["creditToea"],
            };
            return { row, seq: c["numberSeq"] as number };
          })
          .sort((a, b) => b.seq - a.seq)
          .map((x) => x.row);
      } catch {
        return OFFLINE;
      }
    },

    async creditable(invoiceId) {
      try {
        const d = await getDoc(ref(`invoices/${invoiceId}`));
        if (!d.exists()) return null;
        const i = d.data() as InvoiceDocument;
        const row: CreditableRow = {
          id: d.id, number: i.number, customerName: i.snapshot?.tenantName ?? i.tenantName, status: i.status, documentTitle: i.documentTitle,
          lines: i.lines, totalToea: i.totalToea, ...moneyOf(i), ...(i.creditNotedLines === undefined ? {} : { creditNotedLines: i.creditNotedLines }),
        };
        return row;
      } catch {
        return OFFLINE;
      }
    },

    issueCreditNote: (creditNoteId, input, emailIt) =>
      call("issueCreditNote", { orgId, creditNoteId, ...input, lines: input.lines.map((l) => ({ ...l })), emailIt }, (r) => r.message ?? "Issued."),
    resendCreditNote: (creditNoteId) => call("resendCreditNote", { orgId, creditNoteId }, (r) => r.message ?? "Emailed again."),

    async openCreditNotePdf(creditNoteId) {
      let file: { filename: string; base64: string } | undefined;
      const outcome = await call("creditNotePdf", { orgId, creditNoteId }, (r) => {
        file = r as unknown as { filename: string; base64: string };
        return "";
      });
      if (file !== undefined) save(file.filename, new Blob([fromBase64(file.base64)], { type: "application/pdf" }));
      return outcome;
    },

    async setNextNumber(next) {
      try {
        await httpsCallable(functions, "setNextInvoiceNumber")({ orgId, next });
        return null;
      } catch (e) {
        // The callable's own message is plain English (e.g. "already been numbered").
        const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
        return code.startsWith("functions/") && code !== "functions/unavailable" && e instanceof Error ? e.message : OFFLINE;
      }
    },
  };
}
