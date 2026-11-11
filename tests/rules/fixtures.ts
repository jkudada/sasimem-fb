import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { randomOrgId } from "./harness.js";

export interface Seeded {
  readonly orgId: string;
  readonly ownerUid: string;
  readonly propertyId: string;
  readonly unitId: string;
  readonly tenantId: string;
}

export const validOrgProfile = {
  name: "Wari Holdings",
  address: "Section 12, Lot 4, Boroko",
  email: "mary@wari.example",
  gstRegistered: false,
  gstNumber: "",
  bankName: "BSP",
  bankAccount: "1000 2345 6789",
  invoicePrefix: "INV-",
  timezone: "Pacific/Port_Moresby",
  approvalLeadDays: 3,
  sendHour: 8,
  reminderAfterDays: 7,
  reminderMode: "auto",
};

/** An org (and its subscription) as createOrg leaves it, plus one property and one tenant, written with rules off. */
export async function seedOrg(env: RulesTestEnvironment): Promise<Seeded> {
  const s: Seeded = { orgId: randomOrgId(), ownerUid: `owner-${crypto.randomUUID()}`, propertyId: "p1", unitId: "u1", tenantId: "t1" };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const org = `orgs/${s.orgId}`;
    await setDoc(doc(db, org), { ...validOrgProfile, createdAt: new Date("2026-01-01T00:00:00Z") });
    await setDoc(doc(db, `${org}/members/${s.ownerUid}`), { role: "owner", addedAt: new Date("2026-01-01T00:00:00Z") });
    await setDoc(doc(db, `${org}/private/counter`), { nextInvoiceNumber: 1 });
    await setDoc(doc(db, `subscriptions/${s.orgId}`), subscriptionDoc());
    await setDoc(doc(db, `${org}/properties/${s.propertyId}`), { address: "Section 12, Lot 4, Boroko", useType: "residential", units: [{ id: s.unitId, label: "Flat 1" }] });
    await setDoc(doc(db, `${org}/tenants/${s.tenantId}`), { name: "Peter Kila", email: "peter@kila.example", phone: "" });
  });
  return s;
}

/** A tenancy document that should pass the rules, for the seeded org. */
export const validTenancy = (s: Seeded, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  propertyId: s.propertyId,
  unitId: s.unitId,
  tenantId: s.tenantId,
  tenantName: "Peter Kila",
  unitLabel: "Flat 1",
  propertyAddress: "Section 12, Lot 4, Boroko",
  useType: "residential",
  rentToea: 120_000,
  startDate: "2026-01-01",
  endDate: null,
  billingDay: 1,
  dueDays: 7,
  referenceCode: "KILA",
  invoiced: false,
  extras: [],
  ...overrides,
});

/** A subscription as createOrg leaves it: a Standard trial with nothing counted yet. */
export const subscriptionDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  planId: "standard", status: "trial", interval: "annual", priceToea: 40_000, tenancyLimit: 10, limitOverride: null,
  trialEndsOn: "2027-01-06", paidThrough: null, graceDays: 14, cancelledOn: null, purgeAfter: null,
  paymentReference: "SUB-0001", activeTenancyCount: 0,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});
