/**
 * Which modules and features an org has, and the number sequence for each kind of
 * document (docs/PLAN-GENERAL-INVOICING.md §3, §5.4). Read with defaults, so orgs
 * created before G1 need no migration: they are Rentals orgs with today's features.
 */
import { invoiceNumber } from "./billing.js";

export const MODULES = ["rentals", "trades", "general"] as const;
export type ModuleId = (typeof MODULES)[number];

export const FEATURES = ["rentals", "repeating", "oneOff", "quotes", "tradeJobs"] as const;
export type Feature = (typeof FEATURES)[number];
export type Features = Readonly<Record<Feature, boolean>>;

/** The stored fields this reads. Untyped on purpose: it comes from Firestore. */
export interface ModuleFields {
  readonly modules?: unknown;
  readonly features?: unknown;
}

const TODAY: Features = { rentals: true, repeating: true, oneOff: false, quotes: false, tradeJobs: false };

const isModule = (m: unknown): m is ModuleId => typeof m === "string" && (MODULES as readonly string[]).includes(m);

/** The org's modules; unknown names are dropped, and an org always has at least one. */
export function orgModules(org: ModuleFields): readonly ModuleId[] {
  const known = Array.isArray(org.modules) ? org.modules.filter(isModule) : [];
  return known.length > 0 ? known : ["rentals"];
}

/**
 * The org's features. With none stored they follow the modules: Rentals brings today's
 * features, other modules bring none until a plan switches them on. Only `true` switches one on.
 */
export function orgFeatures(org: ModuleFields): Features {
  if (org.features === undefined || org.features === null || typeof org.features !== "object") {
    return orgModules(org).includes("rentals") ? TODAY : off();
  }
  const stored = org.features as Record<string, unknown>;
  return Object.fromEntries(FEATURES.map((f) => [f, stored[f] === true])) as Record<Feature, boolean>;
}

const off = (): Features => Object.fromEntries(FEATURES.map((f) => [f, false])) as Record<Feature, boolean>;

export const hasFeature = (org: ModuleFields, feature: Feature): boolean => orgFeatures(org)[feature];

// ---------------------------------------------------------------- document numbers

export type DocumentKind = "invoice" | "quote" | "creditNote" | "receipt";

/**
 * Each kind's field on `private/counter` and its prefix. Invoices keep today's field
 * and the org's own prefix; the others are added to the same document when first used.
 */
export const COUNTERS: Readonly<Record<DocumentKind, { readonly field: string; readonly prefix: string }>> = {
  invoice: { field: "nextInvoiceNumber", prefix: "INV-" },
  quote: { field: "nextQuoteNumber", prefix: "QUO-" },
  creditNote: { field: "nextCreditNoteNumber", prefix: "CN-" },
  receipt: { field: "nextReceiptNumber", prefix: "RCT-" },
};

/** The next number for a kind; a missing or broken field reads as 1. */
export function nextNumberOf(counter: Readonly<Record<string, unknown>>, kind: DocumentKind): number {
  const n = counter[COUNTERS[kind].field];
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/** "WK-0142" for an invoice (the org's prefix), "QUO-0012" for a quote. */
export function documentNumber(kind: DocumentKind, n: number, org: { readonly invoicePrefix: string }): string {
  return invoiceNumber(kind === "invoice" ? org.invoicePrefix : COUNTERS[kind].prefix, n);
}
