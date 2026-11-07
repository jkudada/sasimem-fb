/** Editing and approving a run from the console (plan §6.2): the same store code as the page. */
import { type Period, type RunStatus, type Toea, amountProblem, parsePeriod, periodLabel } from "@sasimem/core";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { whenLabel } from "../mail/templates.js";
import { approveRun } from "../store/approval.js";
import { editInvoice, type InvoiceEdit, rebuild, Refused } from "../store/edits.js";
import { renderMissingPdfs } from "../store/pdfs.js";
import { type OrgDoc, refs } from "../store/runs.js";
import { ownerOrg, uidOf } from "./auth.js";

/** Turn a store refusal into the plain message the console shows. */
async function plainly<T>(act: () => Promise<T>): Promise<T> {
  try {
    return await act();
  } catch (e) {
    if (e instanceof Refused) throw new HttpsError("failed-precondition", e.message);
    throw e;
  }
}

const invoiceIdOf = (request: CallableRequest<unknown>): string => {
  const id = (request.data as { invoiceId?: unknown }).invoiceId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,140}$/.test(id)) throw new HttpsError("invalid-argument", "That does not look like an invoice.");
  return id;
};

const periodOf = (request: CallableRequest<unknown>): Period => {
  try {
    return parsePeriod(String((request.data as { period?: unknown }).period ?? ""));
  } catch {
    throw new HttpsError("invalid-argument", "That does not look like a month.");
  }
};

function rentOf(request: CallableRequest<unknown>): Toea {
  const rent = (request.data as { rentToea?: unknown }).rentToea;
  if (typeof rent !== "number" || !Number.isInteger(rent)) throw new HttpsError("invalid-argument", "Enter an amount like K1,200.00.");
  if (rent < 0) throw new HttpsError("invalid-argument", "Rent cannot be negative.");
  const problem = amountProblem(rent as Toea);
  if (problem !== null) throw new HttpsError("invalid-argument", problem);
  return rent as Toea;
}

const editing = (read: (request: CallableRequest<unknown>) => InvoiceEdit) =>
  onCall<unknown, Promise<{ ok: true }>>(async (request) => {
    const orgId = await ownerOrg(request);
    const edit = read(request);
    await plainly(() => editInvoice(orgId, invoiceIdOf(request), edit));
    return { ok: true };
  });

export const setRent = editing((request) => ({ rentToea: rentOf(request) }));
export const exclude = editing(() => ({ exclude: true }));
export const include = editing(() => ({ include: true }));

export const rebuildRun = onCall<unknown, Promise<{ ok: true }>>(async (request) => {
  const orgId = await ownerOrg(request);
  await plainly(() => rebuild(orgId, periodOf(request)));
  return { ok: true };
});

export const approveRunCallable = onCall<unknown, Promise<{ status: RunStatus; message: string }>>(async (request) => {
  const orgId = await ownerOrg(request);
  const period = periodOf(request);
  const outcome = await approveRun(orgId, period, { actor: uidOf(request), now: new Date() });
  const label = periodLabel(period);
  if (outcome === "noRun") throw new HttpsError("failed-precondition", `${label} has no invoices yet.`);
  if (outcome === "refused") throw new HttpsError("failed-precondition", `${label} cannot be approved now.`);
  await renderMissingPdfs(orgId, period);
  const r = refs(orgId);
  const [run, org] = await Promise.all([r.run(period).get(), r.org.get()]);
  if (outcome === "alreadyApproved") return { status: run.get("status") as RunStatus, message: `${label} was already approved.` };
  const n = run.get("invoiceCount") as number;
  const when = whenLabel((run.get("sendAt") as { toDate(): Date }).toDate(), (org.data() as OrgDoc).timezone);
  return { status: "approved", message: `Approved ${n} ${n === 1 ? "invoice" : "invoices"}. They go out at ${when}.` };
});
