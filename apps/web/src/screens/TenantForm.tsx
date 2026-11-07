import { useSignal } from "@preact/signals";
import { type TenantInput, deleteProblem, tenantProblems } from "@sasimem/core";
import type { Setup } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";

type Problems = ReturnType<typeof tenantProblems>;

export function TenantForm(props: {
  id: string | null;
  setup: Setup;
  onSave: (id: string | null, tenant: TenantInput) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const before = props.setup.tenants.find((t) => t.id === props.id);
  const name = useSignal(before?.name ?? "");
  const email = useSignal(before?.email ?? "");
  const phone = useSignal(before?.phone ?? "");
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
    problems.value = tenantProblems(tenant);
    failure.value = null;
    if (Object.keys(problems.value).length > 0) return;
    await run(() => props.onSave(props.id, tenant));
  };

  const remove = async () => {
    if (props.id === null) return;
    const id = props.id;
    failure.value = deleteProblem({ tenantId: id }, props.setup.tenancies);
    if (failure.value === null) await run(() => props.onDelete(id));
  };

  const p = problems.value;
  return (
    <main class="narrow">
      <Back href="/tenants" label="Tenants" />
      <h1>{before === undefined ? "Add a tenant" : "Edit tenant"}</h1>
      <form onSubmit={submit} noValidate>
        <Field label="Tenant's name" hint="As it should appear on invoices." problem={p.name}>
          <input value={name} onInput={(e) => (name.value = value(e))} />
        </Field>
        <Field label="Tenant's email" hint="Invoices are emailed here." problem={p.email}>
          <input type="email" value={email} onInput={(e) => (email.value = value(e))} />
        </Field>
        <Field label="Tenant's phone (optional)">
          <input type="tel" value={phone} onInput={(e) => (phone.value = value(e))} />
        </Field>
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Save</button>
        {before !== undefined && <button type="button" class="danger" disabled={busy} onClick={() => void remove()}>Delete this tenant</button>}
      </form>
    </main>
  );
}
