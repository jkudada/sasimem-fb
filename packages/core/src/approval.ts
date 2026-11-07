/**
 * Step 4: what approval needs that is pure - the snapshot it freezes, redrafting
 * a run, and reading the approval page's form. The transaction that writes these
 * lives in functions; nothing here does I/O.
 */
import { draftInvoice, isActiveIn, withRent } from "./billing.js";
import { amountProblem, formatKina, parseKina, type Toea } from "./money.js";
import { type Period, periodLabel } from "./period.js";
import type { BillingOrg, DraftInvoice, InvoiceSnapshot, InvoiceStatus, OrgProfile, Tenancy, TenancyDocument } from "./types.js";

export function invoiceSnapshot(
  org: OrgProfile & { readonly logoPath?: string | undefined },
  tenancy: Pick<TenancyDocument, "tenantName" | "unitLabel" | "propertyAddress">,
  tenantEmail: string,
): InvoiceSnapshot {
  return {
    org: {
      name: org.name, address: org.address, email: org.email, logoPath: org.logoPath ?? null,
      gstRegistered: org.gstRegistered, gstNumber: org.gstNumber, bankName: org.bankName, bankAccount: org.bankAccount,
    },
    tenantName: tenancy.tenantName,
    tenantEmail,
    unitLabel: tenancy.unitLabel,
    propertyAddress: tenancy.propertyAddress,
  };
}

/** Only these are rebuilt or removed by a redraft; anything approved or later is history. */
const REDRAFTABLE: ReadonlySet<InvoiceStatus> = new Set(["draft", "excluded"]);

export interface ExistingInvoice {
  readonly id: string;
  readonly tenancyId: string;
  readonly status: InvoiceStatus;
}

export interface RedraftPlan {
  readonly create: readonly DraftInvoice[];
  /** Rebuilt from current data; an excluded invoice stays excluded. */
  readonly rebuild: readonly { readonly id: string; readonly status: InvoiceStatus; readonly draft: DraftInvoice }[];
  readonly remove: readonly string[];
}

/** What a (re)draft of a period should write, given the invoices it already has. */
export function redraftPlan(req: {
  org: Pick<BillingOrg, "gstRegistered">;
  period: Period;
  tenancies: readonly Tenancy[];
  existing: readonly ExistingInvoice[];
}): RedraftPlan {
  const active = new Map(req.tenancies.filter((t) => isActiveIn(t, req.period)).map((t) => [t.id, t]));
  const byTenancy = new Map(req.existing.map((i) => [i.tenancyId, i]));
  const draft = (tenancy: Tenancy) => draftInvoice({ org: req.org, tenancy, period: req.period });
  return {
    create: [...active.values()].filter((t) => !byTenancy.has(t.id)).map(draft),
    rebuild: req.existing.flatMap((i) => {
      const tenancy = active.get(i.tenancyId);
      return tenancy !== undefined && REDRAFTABLE.has(i.status) ? [{ id: i.id, status: i.status, draft: draft(tenancy) }] : [];
    }),
    remove: req.existing.filter((i) => REDRAFTABLE.has(i.status) && !active.has(i.tenancyId)).map((i) => i.id),
  };
}

export interface ApprovalEdits {
  readonly rents: Readonly<Record<string, Toea>>;
  readonly included: readonly string[];
}

export type ApprovalForm = ({ readonly ok: true } & ApprovalEdits) | { readonly ok: false; readonly problems: Readonly<Record<string, string>> };

const STALE = "This page is out of date. Reload it and try again.";

/** Read the page's form: `rent.{id}` as kina, `include.{id}` ticked. Every row must be present. */
export function readApprovalForm(form: Readonly<Record<string, string | undefined>>, invoiceIds: readonly string[]): ApprovalForm {
  const rents: Record<string, Toea> = {};
  const problems: Record<string, string> = {};
  for (const id of invoiceIds) {
    const text = form[`rent.${id}`];
    if (text === undefined) {
      problems[id] = STALE;
      continue;
    }
    const read = readRent(text);
    if (typeof read === "string") problems[id] = read;
    else rents[id] = read;
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, rents, included: invoiceIds.filter((id) => form[`include.${id}`] !== undefined) };
}

function readRent(text: string): Toea | string {
  let amount: Toea;
  try {
    amount = parseKina(text);
  } catch {
    return "Enter an amount like K1,200.00.";
  }
  if (amount < 0) return "Rent cannot be negative.";
  return amountProblem(amount) ?? amount;
}

export interface EditableInvoice {
  readonly id: string;
  readonly status: InvoiceStatus;
  readonly draft: DraftInvoice;
}

/** Each editable invoice as the form leaves it: its rent applied, ticked or excluded. */
export function applyApprovalEdits(invoices: readonly EditableInvoice[], edits: ApprovalEdits): EditableInvoice[] {
  const included = new Set(edits.included);
  return invoices.map((inv) => {
    const rent = edits.rents[inv.id];
    const rentLine = inv.draft.lines.find((l) => l.kind === "rent");
    const draft = rent !== undefined && rentLine !== undefined && rentLine.amountToea !== rent ? withRent(inv.draft, rent) : inv.draft;
    return { id: inv.id, status: included.has(inv.id) ? "draft" : "excluded", draft };
  });
}

export function digestSubject(req: { period: Period; count: number; totalToea: Toea }): string {
  return `${req.count} ${req.count === 1 ? "invoice" : "invoices"} ready for ${periodLabel(req.period)} - ${formatKina(req.totalToea)}`;
}
