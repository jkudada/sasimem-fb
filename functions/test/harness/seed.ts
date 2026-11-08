/**
 * Builders for T3 (plan §9.1): an org made by the real createOrg, plus the tenants,
 * properties and tenancies a test names. Each test gets its own org.
 */
import type { Charge } from "@sasimem/core";
import { makeCreateOrg } from "../../src/callables/createOrg.js";
import { newUser, request, typedOrg } from "./callables.js";
import { adminDb } from "./index.js";

const createOrg = makeCreateOrg({ now: () => new Date("2026-09-01T00:00:00Z"), signupMode: () => "open" });

export interface TenancySeed {
  id: string;
  tenantName?: string;
  tenantEmail?: string;
  rent?: number;
  useType?: "residential" | "commercial";
  startDate?: string;
  endDate?: string | null;
  billingDay?: number;
  dueDays?: number;
  reference?: string;
  extras?: Charge[];
}

export interface SeededOrg {
  readonly uid: string;
  readonly orgId: string;
}

export async function anOrgWith(opts: { tenancies?: TenancySeed[]; org?: Record<string, unknown>; firstInvoiceNumber?: number } = {}): Promise<SeededOrg> {
  const uid = await newUser();
  const { orgId } = await createOrg.run(request(uid, { ...typedOrg, ...opts.org, firstInvoiceNumber: opts.firstInvoiceNumber ?? 1 }));
  for (const t of opts.tenancies ?? []) await addTenancy(orgId, t);
  return { uid, orgId };
}

export async function addTenancy(orgId: string, t: TenancySeed): Promise<void> {
  const db = adminDb();
  const org = `orgs/${orgId}`;
  const tenantName = t.tenantName ?? `Tenant ${t.id}`;
  const useType = t.useType ?? "residential";
  await db.doc(`${org}/tenants/tenant-${t.id}`).set({ name: tenantName, email: t.tenantEmail ?? `${t.id}@tenant.example`, phone: "" });
  await db.doc(`${org}/properties/prop-${t.id}`).set({ address: `Lot ${t.id}, Boroko`, useType, units: [{ id: "u1", label: `Flat ${t.id}` }] });
  await db.doc(`${org}/tenancies/${t.id}`).set({
    propertyId: `prop-${t.id}`, unitId: "u1", tenantId: `tenant-${t.id}`,
    tenantName, unitLabel: `Flat ${t.id}`, propertyAddress: `Lot ${t.id}, Boroko`, useType,
    rentToea: t.rent ?? 120_000, startDate: t.startDate ?? "2026-01-01", endDate: t.endDate ?? null,
    billingDay: t.billingDay ?? 1, dueDays: t.dueDays ?? 7, referenceCode: t.reference ?? (t.id.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "REF"),
    invoiced: false, extras: t.extras ?? [],
  });
}

/** An org whose October 2026 invoices were approved, rendered and released on 1 October. */
export async function aSentMonth(opts: { tenancies?: TenancySeed[]; org?: Record<string, unknown> } = {}): Promise<SeededOrg> {
  const { parsePeriod } = await import("@sasimem/core");
  const { draftRun } = await import("../../src/store/runs.js");
  const { approveRun } = await import("../../src/store/approval.js");
  const { renderMissingPdfs } = await import("../../src/store/pdfs.js");
  const { releaseRun } = await import("../../src/store/release.js");
  const seeded = await anOrgWith({ tenancies: opts.tenancies ?? [{ id: "k1", tenantName: "Peter Kila" }], ...(opts.org === undefined ? {} : { org: opts.org }) });
  const OCT = parsePeriod("2026-10");
  await draftRun(seeded.orgId, OCT, new Date("2026-09-28T00:00:00Z"));
  await approveRun(seeded.orgId, OCT, { actor: "uid", now: new Date("2026-09-28T00:00:00Z") });
  await renderMissingPdfs(seeded.orgId, OCT);
  const released = await releaseRun(seeded.orgId, OCT, new Date("2026-09-30T22:00:00Z"));
  if (!released.released) throw new Error("the seeded month was not released");
  return seeded;
}
