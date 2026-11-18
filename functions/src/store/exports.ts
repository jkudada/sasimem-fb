/**
 * "Export everything" (PLAN-SUBSCRIBERS §11, S6). The org's records as CSV and every
 * invoice PDF, zipped into `exports/{orgId}/` (server only: storage.rules opens nothing
 * there), behind a link that works for an hour. A link is `exportLinks/{sha256(token)}`,
 * as approval links are: the database never holds the token itself. A new export
 * replaces the org's last one, file and link, so there is never more than one.
 */
import {
  type CalendarDate, chargesCsv, type CsvRow, EXPORT_LINK_MINUTES, exportFilename, exportPdfName, type InvoiceDocument, invoicesCsv, localDate,
  paymentsCsv, propertiesCsv, type PropertyRow, tenanciesCsv, type TenancyRow, tenantsCsv, type TenantRow,
} from "@sasimem/core";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { bucket, db } from "../admin.js";
import { tokenId } from "../links.js";
import { zip, type ZipEntry } from "../zip.js";
import type { OrgDoc } from "./runs.js";

const LINK_MS = EXPORT_LINK_MINUTES * 60_000;
/** PDFs fetched at once while zipping. */
const PARALLEL = 16;

export const exportLinks = () => db().collection("exportLinks");

type StoredInvoice = InvoiceDocument & { voidReason?: string; numberSeq: number | null; paidAt?: unknown };

const dateIn = (v: unknown, timezone: string): CalendarDate | null => (v instanceof Timestamp ? localDate(v.toDate(), timezone) : null);

/** An issued invoice as a CSV row: the same as the Payments screen's export. */
export function csvRowOf(i: StoredInvoice, timezone: string): CsvRow {
  return {
    number: i.number ?? "", issueDate: i.issueDate, dueDate: i.dueDate, period: i.period,
    tenantName: i.snapshot?.tenantName ?? i.tenantName, unitLabel: i.snapshot?.unitLabel ?? i.unitLabel, paymentReference: i.paymentReference,
    subtotalToea: i.subtotalToea, gstToea: i.gstToea, totalToea: i.totalToea, status: i.status,
    paidOn: dateIn(i.paidAt, timezone), paidNote: i.paidNote, voidReason: i.voidReason ?? "",
  };
}

/** Run `each` over `items`, `n` at a time. */
async function inBatches<T, R>(items: readonly T[], n: number, each: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(each))));
  return out;
}

/** Every file of the export: the CSVs, then each issued invoice's PDF. */
export async function exportEntries(orgId: string): Promise<{ orgName: string; timezone: string; entries: ZipEntry[] }> {
  const org = db().doc(`orgs/${orgId}`);
  const [orgSnap, properties, tenants, tenancies, invoiceSnap] = await Promise.all([
    org.get(), org.collection("properties").get(), org.collection("tenants").get(), org.collection("tenancies").get(), org.collection("invoices").get(),
  ]);
  const profile = (orgSnap.data() ?? {}) as Partial<OrgDoc> & { name?: string };
  const timezone = profile.timezone ?? "Pacific/Port_Moresby";
  const invoices = invoiceSnap.docs
    .map((d) => ({ id: d.id, i: d.data() as StoredInvoice }))
    .filter(({ i }) => i.number !== null)
    .sort((a, b) => (a.i.numberSeq ?? 0) - (b.i.numberSeq ?? 0));

  const text = (name: string, csv: string): ZipEntry => ({ name, data: Buffer.from(csv, "utf8") });
  const tenancyRows = tenancies.docs.map((d) => ({ id: d.id, ...d.data() }) as TenancyRow);
  const entries: ZipEntry[] = [
    text("properties.csv", propertiesCsv(properties.docs.map((d) => ({ id: d.id, ...d.data() }) as PropertyRow))),
    text("tenants.csv", tenantsCsv(tenants.docs.map((d) => ({ id: d.id, ...d.data() }) as TenantRow))),
    text("tenancies.csv", tenanciesCsv(tenancyRows)),
    text("charges.csv", chargesCsv(tenancyRows)),
    text("invoices.csv", invoicesCsv(invoices.map(({ i }) => csvRowOf(i, timezone)))),
    text("payments.csv", paymentsCsv(invoices.flatMap(({ i }) => {
      const r = csvRowOf(i, timezone);
      return r.paidOn === null ? [] : [{ number: r.number, tenantName: r.tenantName, unitLabel: r.unitLabel, totalToea: r.totalToea, paidOn: r.paidOn, paidNote: r.paidNote }];
    }))),
  ];
  const pdfs = await inBatches(invoices.filter(({ i }) => i.pdfPath !== ""), PARALLEL, async ({ id, i }) => {
    const [data] = await bucket().file(i.pdfPath).download();
    return { name: exportPdfName(i.number, id), data };
  });
  return { orgName: profile.name ?? "", timezone, entries: [...entries, ...pdfs] };
}

export interface MadeExport {
  readonly filename: string;
  readonly expiresAt: Date;
}

/**
 * Zip the org's records, store them and give `token` an hour to download them. Removes
 * the org's earlier export first, so an old link stops working.
 */
export async function makeExport(orgId: string, now: Date, token: string): Promise<MadeExport> {
  const { orgName, timezone, entries } = await exportEntries(orgId);
  const today = localDate(now, timezone);
  const filename = exportFilename(orgName, today);
  // The zip's file times: the landlord's wall clock, which zip stores without a zone.
  const wall = new Date(`${today}T${now.toLocaleTimeString("en-GB", { timeZone: timezone, hourCycle: "h23" })}Z`);
  const body = zip(entries, Number.isNaN(wall.getTime()) ? now : wall);

  await removeExports(orgId);
  const path = `exports/${orgId}/${randomUUID()}.zip`;
  await bucket().file(path).save(body, { contentType: "application/zip", resumable: false });
  const expiresAt = new Date(now.getTime() + LINK_MS);
  await exportLinks().doc(tokenId(token)).create({ orgId, path, filename, createdAt: now, expiresAt: Timestamp.fromDate(expiresAt) });
  return { filename, expiresAt };
}

/** Delete the org's exports and their links. */
export async function removeExports(orgId: string): Promise<void> {
  const links = await exportLinks().where("orgId", "==", orgId).get();
  await bucket().deleteFiles({ prefix: `exports/${orgId}/` });
  await Promise.all(links.docs.map((d) => d.ref.delete()));
}

/** Exports whose link ran out more than a day ago, removed by the daily tick. Returns how many. */
export async function sweepExports(now: Date): Promise<number> {
  const old = await exportLinks().where("expiresAt", "<", Timestamp.fromMillis(now.getTime() - 86_400_000)).get();
  await Promise.all(old.docs.map(async (d) => {
    await bucket().file(String(d.get("path"))).delete({ ignoreNotFound: true });
    await d.ref.delete();
  }));
  return old.size;
}

export type ExportLookup =
  | { readonly state: "live"; readonly path: string; readonly filename: string }
  | { readonly state: "expired" }
  | { readonly state: "unknown" };

export async function lookupExport(token: string, now: Date): Promise<ExportLookup> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { state: "unknown" };
  const snap = await exportLinks().doc(tokenId(token)).get();
  if (!snap.exists) return { state: "unknown" };
  const expiresAt = snap.get("expiresAt") as Timestamp;
  if (expiresAt.toMillis() <= now.getTime()) return { state: "expired" };
  return { state: "live", path: String(snap.get("path")), filename: String(snap.get("filename")) };
}
