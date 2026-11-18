/**
 * Decisions for the subscriber ops scripts (PLAN-SUBSCRIBERS S1): seeding plans,
 * backfilling subscriptions, granting the operator claim. The scripts run under plain
 * node, which cannot load core's sources, so the little they need from core is copied
 * here; test/subscribers.test.ts proves each copy equal to core's.
 */
type Value =
  | { stringValue: string } | { integerValue: string } | { booleanValue: boolean }
  | { nullValue: null } | { timestampValue: string };
type Plain = string | number | boolean | null | Date;

export interface Write {
  readonly update: { readonly name: string; readonly fields: Record<string, Value> };
  /** Create-only when present; absent, the write replaces the document (billing details). */
  readonly currentDocument?: { readonly exists: false };
}

export const documentsRoot = (project: string): string => `projects/${project}/databases/(default)/documents`;

function encode(key: string, v: Plain): Value {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (!Number.isInteger(v)) throw new Error(`${key} must be a whole number (money is whole toea, I7), got ${v}`);
  return { integerValue: String(v) };
}

export function encodeFields(o: Readonly<Record<string, Plain>>): Record<string, Value> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encode(k, v)]));
}

/** Create-only: a rerun never overwrites what is there. */
const createWrite = (project: string, path: string, fields: Readonly<Record<string, Plain>>): Write => ({
  update: { name: `${documentsRoot(project)}/${path}`, fields: encodeFields(fields) },
  currentDocument: { exists: false },
});

// ---------------------------------------------------------------- plans

/** Copy of core's DEFAULT_PLANS. */
export const OPS_PLANS = [
  { id: "free", name: "Free", tenancyLimit: 2, priceToeaMonthly: 0, priceToeaAnnual: 0, public: true, order: 0 },
  { id: "standard", name: "Standard", tenancyLimit: 10, priceToeaMonthly: 4_000, priceToeaAnnual: 40_000, public: true, order: 1 },
  { id: "plus", name: "Plus", tenancyLimit: 30, priceToeaMonthly: 10_000, priceToeaAnnual: 100_000, public: true, order: 2 },
] as const;

/** The plans not yet in Firestore. Existing ones are left as they are: their prices may have been changed on purpose. */
export function planWrites(project: string, existing: ReadonlySet<string>): Write[] {
  return OPS_PLANS.filter((p) => !existing.has(p.id)).map(({ id, ...fields }) => createWrite(project, `plans/${id}`, fields));
}

// ---------------------------------------------------------------- backfill (D6)

/** Port Moresby's calendar day: UTC+10 all year. */
export const portMoresbyToday = (now: Date): string => new Date(now.getTime() + 10 * 3_600_000).toISOString().slice(0, 10);

/** Copy of core's newFreeSubscription. */
export function freeSubscription(activeTenancyCount: number) {
  const free = OPS_PLANS[0];
  const limitOverride = activeTenancyCount > free.tenancyLimit ? activeTenancyCount : null;
  return {
    planId: "free", status: "free", interval: "annual", priceToea: 0,
    tenancyLimit: limitOverride ?? free.tenancyLimit, limitOverride,
    trialEndsOn: null, paidThrough: null, graceDays: 14, cancelledOn: null, purgeAfter: null,
    paymentReference: null, activeTenancyCount,
  } as const;
}

export interface OrgTenancies {
  readonly id: string;
  readonly tenancyEndDates: readonly (string | null)[];
}

/** A free subscription for every org that has none, counting tenancies that have not ended. */
export function backfillWrites(project: string, orgs: readonly OrgTenancies[], haveSubscription: ReadonlySet<string>, now: Date): Write[] {
  const today = portMoresbyToday(now);
  return orgs.filter((o) => !haveSubscription.has(o.id)).map((o) => {
    const count = o.tenancyEndDates.filter((e) => e === null || e >= today).length;
    return createWrite(project, `subscriptions/${o.id}`, { ...freeSubscription(count), createdAt: now, updatedAt: now });
  });
}

// ---------------------------------------------------------------- the operator claim (D10)

/** The user's custom claims with `operator` granted or revoked; every other claim kept. */
export function operatorClaims(existing: string | undefined, grant: boolean): string {
  const claims = existing === undefined || existing === "" ? {} : (JSON.parse(existing) as Record<string, unknown>);
  const { operator: _old, ...rest } = claims;
  return JSON.stringify(grant ? { ...rest, operator: true } : rest);
}

// ---------------------------------------------------------------- Sasimem's bank details (S4)

export interface BillingDetailsInput {
  readonly accountName?: string | undefined;
  readonly bankName?: string | undefined;
  readonly accountNumber?: string | undefined;
  readonly branch?: string | undefined;
  readonly contactEmail?: string | undefined;
}

/**
 * sasimem/billing: where subscribers pay, shown on every landlord's banner and Plan & billing
 * page. Replaced whole on each run, since the details are meant to change when the bank does.
 */
export function billingDetailsWrite(project: string, input: BillingDetailsInput): Write {
  const need = (k: "accountName" | "bankName" | "accountNumber", flagName: string): string => {
    const v = input[k]?.trim() ?? "";
    if (v === "") throw new Error(`--${flagName} is required`);
    if (v.length > 80) throw new Error(`--${flagName} is too long (80 characters at most)`);
    return v;
  };
  const optional = (v: string | undefined): string | null => (v === undefined || v.trim() === "" ? null : v.trim());
  const contactEmail = optional(input.contactEmail);
  if (contactEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error(`--contact-email is not an email address: ${contactEmail}`);
  return {
    update: {
      name: `${documentsRoot(project)}/sasimem/billing`,
      fields: encodeFields({
        accountName: need("accountName", "account-name"), bankName: need("bankName", "bank"), accountNumber: need("accountNumber", "account-number"),
        branch: optional(input.branch), contactEmail,
      }),
    },
  };
}
