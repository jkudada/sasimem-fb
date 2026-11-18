/**
 * "Export everything" (PLAN-SUBSCRIBERS §11, S6): the landlord's records as CSV files,
 * zipped by the exportEverything callable with every invoice PDF. Pure: the callable
 * reads Firestore and hands the rows here. Invoices themselves use invoicesCsv (payments.ts),
 * the same file the CSV export on the Payments screen gives.
 */
import { csvDecimal, csvText } from "./payments.js";
import type { CalendarDate } from "./period.js";
import type { Charge, GstTreatment, Unit, UseType } from "./types.js";

/** How long the download stays open after the export is made. */
export const EXPORT_LINK_MINUTES = 60;

const file = (header: readonly string[], lines: readonly (readonly string[])[]): string =>
  [header.join(","), ...lines.map((l) => l.join(",")), ""].join("\r\n");
const byText = <T>(key: (t: T) => string) => (a: T, b: T): number => key(a).localeCompare(key(b));

export interface PropertyRow { readonly id: string; readonly address: string; readonly useType: UseType; readonly units: readonly Unit[] }
export function propertiesCsv(rows: readonly PropertyRow[]): string {
  return file(["property_id", "address", "use", "unit_id", "unit"],
    [...rows].sort(byText((p) => p.address)).flatMap((p) => p.units.map((u) => [csvText(p.id), csvText(p.address), p.useType, csvText(u.id), csvText(u.label)])));
}

export interface TenantRow { readonly id: string; readonly name: string; readonly email: string; readonly phone: string }
export function tenantsCsv(rows: readonly TenantRow[]): string {
  return file(["tenant_id", "name", "email", "phone"],
    [...rows].sort(byText((t) => t.name)).map((t) => [csvText(t.id), csvText(t.name), csvText(t.email), csvText(t.phone)]));
}

export interface TenancyRow {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly propertyId: string;
  readonly propertyAddress: string;
  readonly unitId: string;
  readonly unitLabel: string;
  readonly useType: UseType;
  readonly rentToea: number;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate | null;
  readonly billingDay: number;
  readonly dueDays: number;
  readonly referenceCode: string;
  readonly extras: readonly Charge[];
}
export function tenanciesCsv(rows: readonly TenancyRow[]): string {
  return file(["tenancy_id", "tenant_id", "tenant", "property_id", "property", "unit_id", "unit", "use", "rent", "start", "end", "billing_day", "due_days", "reference"],
    [...rows].sort(byText((t) => t.tenantName)).map((t) => [
      csvText(t.id), csvText(t.tenantId), csvText(t.tenantName), csvText(t.propertyId), csvText(t.propertyAddress), csvText(t.unitId), csvText(t.unitLabel),
      t.useType, csvDecimal(t.rentToea), t.startDate, t.endDate ?? "", String(t.billingDay), String(t.dueDays), csvText(t.referenceCode),
    ]));
}

const GST: Readonly<Record<GstTreatment, string>> = { inherit: "as the organisation", taxable: "taxable", exempt: "exempt" };
/** Each tenancy's extra charges, in the order they were added. */
export function chargesCsv(rows: readonly Pick<TenancyRow, "id" | "extras" | "tenantName">[]): string {
  return file(["tenancy_id", "charge_id", "description", "amount", "recurrence", "month", "active", "gst"],
    [...rows].sort(byText((t) => t.tenantName)).flatMap((t) => t.extras.map((c) => [
      csvText(t.id), csvText(c.id), csvText(c.description), csvDecimal(c.amountToea), c.recurrence === "every" ? "every month" : "once", c.period ?? "",
      c.active ? "yes" : "no", GST[c.gstTreatment],
    ])));
}

export interface PaymentExportRow {
  readonly number: string;
  readonly tenantName: string;
  readonly unitLabel: string;
  readonly totalToea: number;
  readonly paidOn: CalendarDate;
  readonly paidNote: string;
}
/** The rent received: every invoice marked paid, oldest first. */
export function paymentsCsv(rows: readonly PaymentExportRow[]): string {
  return file(["invoice", "tenant", "unit", "amount", "paid_on", "note"],
    [...rows].sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.number.localeCompare(b.number)).map((p) => [
      csvText(p.number), csvText(p.tenantName), csvText(p.unitLabel), csvDecimal(p.totalToea), p.paidOn, csvText(p.paidNote),
    ]));
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** "sasimem-wari-holdings-2026-11-18.zip" */
export function exportFilename(orgName: string, today: CalendarDate): string {
  return `sasimem-${slug(orgName) || "export"}-${today}.zip`;
}

/** An invoice's PDF inside the zip, by its number (or its ID, if it never had one). */
export function exportPdfName(number: string | null, invoiceId: string): string {
  return `invoices/${(number ?? invoiceId).replace(/[^A-Za-z0-9_.-]+/g, "-")}.pdf`;
}
