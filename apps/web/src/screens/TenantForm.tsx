import { useSignal } from "@preact/signals";
import { type Customer, type TenantInput, customerProblems, deleteProblem, hasFeature, tenantProblems } from "@sasimem/core";
import { type Setup, customerFrom } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { whole } from "./read.js";

type Problems = Partial<Record<keyof Customer, string>>;

/**
 * A tenant, who is also a customer (G1b). With one-off invoices on (G2a) the form shows
 * what a business customer's accounts payable needs: address, TIN, copy-to, terms, PO.
 * Without, it is the Rentals form it always was, and a merge keeps details it does not show.
 */
export function TenantForm(props: {
  id: string | null;
  setup: Setup;
  onSave: (id: string | null, tenant: TenantInput | Customer) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const business = hasFeature(props.setup.org, "oneOff");
  const stored = props.setup.tenants.find((t) => t.id === props.id);
  const before = stored === undefined ? undefined : customerFrom(stored);
  const name = useSignal(before?.name ?? "");
  const email = useSignal(before?.email ?? "");
  const phone = useSignal(before?.phone ?? "");
  const address = useSignal(before?.address ?? "");
  const tin = useSignal(before?.tin ?? "");
  const gstNumber = useSignal(before?.gstNumber ?? "");
  const ccEmails = useSignal(before?.ccEmails.join(", ") ?? "");
  const termsDays = useSignal(before?.termsDays === null || before === undefined ? "" : String(before.termsDays));
  const poRequired = useSignal(before?.poRequired ?? false);
  const notes = useSignal(before?.notes ?? "");
  const problems = useSignal<Problems>({});
  const failure = useSignal<string | null>(null);
  const busy = useSignal(false);

  const run = async (act: () => Promise<string | null>) => {
    busy.value = true;
    failure.value = await act();
    busy.value = false;
    if (failure.value === null) props.onDone();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const tenant: TenantInput = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() };
    const customer: Customer = {
      ...tenant, address: address.value.trim(), tin: tin.value.trim(), gstNumber: gstNumber.value.trim(),
      ccEmails: ccEmails.value.split(/[,;\s]+/).filter((x) => x !== ""),
      termsDays: termsDays.value.trim() === "" ? null : whole(termsDays.value), poRequired: poRequired.value, notes: notes.value.trim(),
    };
    problems.value = business ? customerProblems(customer) : tenantProblems(tenant);
    failure.value = null;
    if (Object.keys(problems.value).length > 0) return;
    await run(() => props.onSave(props.id, business ? customer : tenant));
  };

  const remove = async () => {
    if (props.id === null) return;
    const id = props.id;
    failure.value = deleteProblem({ tenantId: id }, props.setup.tenancies);
    if (failure.value === null) await run(() => props.onDelete(id));
  };

  const p = problems.value;
  const who = business ? "Customer" : "Tenant";
  return (
    <main class="narrow">
      <Back href="/tenants" label={business ? "Tenants and customers" : "Tenants"} />
      <h1>{before === undefined ? `Add a ${who.toLowerCase()}` : `Edit ${who.toLowerCase()}`}</h1>
      <form onSubmit={submit} noValidate>
        <Field label={`${who}'s name`} hint="As it should appear on invoices." problem={p.name}>
          <input value={name} onInput={(e) => (name.value = value(e))} />
        </Field>
        <Field label={`${who}'s email`} hint="Invoices are emailed here." problem={p.email}>
          <input type="email" value={email} onInput={(e) => (email.value = value(e))} />
        </Field>
        <Field label={`${who}'s phone (optional)`} problem={p.phone}>
          <input type="tel" value={phone} onInput={(e) => (phone.value = value(e))} />
        </Field>
        {business && (
          <>
            <h2>For their accounts (optional)</h2>
            <Field label="Copy invoices to" hint="Up to 3 more addresses, such as their accounts team, separated by commas." problem={p.ccEmails}>
              <input inputMode="email" value={ccEmails} onInput={(e) => (ccEmails.value = value(e))} />
            </Field>
            <Field label="Address" hint="Printed under their name on one-off invoices." problem={p.address}>
              <input value={address} onInput={(e) => (address.value = value(e))} />
            </Field>
            <Field label="Their TIN" problem={p.tin}>
              <input value={tin} onInput={(e) => (tin.value = value(e))} />
            </Field>
            <Field label="Their GST number" problem={p.gstNumber}>
              <input value={gstNumber} onInput={(e) => (gstNumber.value = value(e))} />
            </Field>
            <Field label="Days to pay" hint="Leave blank for your usual terms." problem={p.termsDays}>
              <input inputMode="numeric" value={termsDays} onInput={(e) => (termsDays.value = value(e))} />
            </Field>
            <label class="check">
              <input type="checkbox" checked={poRequired} onChange={(e) => (poRequired.value = (e.currentTarget as HTMLInputElement).checked)} />
              They pay only against an order number (PO)
            </label>
            <Field label="Notes for you" hint="Not printed." problem={p.notes}>
              <textarea rows={2} value={notes} onInput={(e) => (notes.value = value(e))} />
            </Field>
          </>
        )}
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Save</button>
        {before !== undefined && <button type="button" class="danger" disabled={busy} onClick={() => void remove()}>{`Delete this ${who.toLowerCase()}`}</button>}
      </form>
    </main>
  );
}
