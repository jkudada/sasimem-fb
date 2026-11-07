import { useSignal } from "@preact/signals";
import {
  type CalendarDate, type PropertyInput, type TenancyInput, type TenantInput, type Toea, type UseType,
  amountProblem, parseKina, propertyProblems, tenancyProblems, tenantProblems,
} from "@sasimem/core";
import { Field, value } from "./Field.js";

export interface FirstTenancy {
  readonly property: PropertyInput;
  readonly tenant: TenantInput;
  readonly terms: TenancyInput;
}

const RENT_PROBLEM = "Enter an amount like K1,200.00.";

/** Read the rent as typed; a problem in plain words, or the amount. */
function readRent(text: string): { rentToea: Toea } | { problem: string } {
  try {
    const rentToea = parseKina(text);
    const problem = amountProblem(rentToea);
    return problem === null ? { rentToea } : { problem };
  } catch {
    return { problem: RENT_PROBLEM };
  }
}

const whole = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);

/** Onboarding, part 2: the first property, tenant and tenancy (plan §7, screen 2). */
export function TenancyStep(props: { today: CalendarDate; onSubmit: (first: FirstTenancy) => Promise<string | null> }) {
  const address = useSignal("");
  const useType = useSignal<UseType>("residential");
  const unitLabel = useSignal("Whole property");
  const tenantName = useSignal("");
  const tenantEmail = useSignal("");
  const tenantPhone = useSignal("");
  const rent = useSignal("");
  const billingDay = useSignal("1");
  const dueDays = useSignal("7");
  const startDate = useSignal<string>(props.today);
  const reference = useSignal("");
  const problems = useSignal<Record<string, string | undefined>>({});
  const failure = useSignal<string | null>(null);
  const busy = useSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    const property: PropertyInput = { address: address.value.trim(), useType: useType.value, units: [{ id: "u1", label: unitLabel.value.trim() }] };
    const tenant: TenantInput = { name: tenantName.value.trim(), email: tenantEmail.value.trim(), phone: tenantPhone.value.trim() };
    const rentRead = readRent(rent.value);
    const terms: TenancyInput = {
      rentToea: "rentToea" in rentRead ? rentRead.rentToea : (0 as Toea),
      startDate: startDate.value.trim(), endDate: null,
      billingDay: whole(billingDay.value), dueDays: whole(dueDays.value), referenceCode: reference.value.trim(),
    };
    const found = {
      ...prefix("property.", propertyProblems(property)),
      ...prefix("tenant.", tenantProblems(tenant)),
      ...prefix("terms.", tenancyProblems(terms)),
      ...("problem" in rentRead ? { "terms.rentToea": rentRead.problem } : {}),
    };
    problems.value = found;
    if (Object.keys(found).length > 0) return;
    busy.value = true;
    failure.value = await props.onSubmit({ property, tenant, terms });
    busy.value = false;
  };

  const p = problems.value;
  return (
    <main class="narrow">
      <h1>Your first tenant</h1>
      <p>Add one now. You can add the rest afterwards.</p>
      <form onSubmit={submit} noValidate>
        <h2>The property</h2>
        <Field label="Property address" problem={p["property.address"]}>
          <input value={address} onInput={(e) => (address.value = value(e))} />
        </Field>
        <fieldset>
          <legend>What is it used for?</legend>
          <label class="check"><input type="radio" name="use" checked={useType.value === "residential"} onChange={() => (useType.value = "residential")} /> Someone lives there</label>
          <label class="check"><input type="radio" name="use" checked={useType.value === "commercial"} onChange={() => (useType.value = "commercial")} /> A business uses it</label>
        </fieldset>
        <Field label="Unit name" hint="Such as Flat 2, or Whole property." problem={p["property.units"]}>
          <input value={unitLabel} onInput={(e) => (unitLabel.value = value(e))} />
        </Field>
        <h2>The tenant</h2>
        <Field label="Tenant's name" problem={p["tenant.name"]}>
          <input value={tenantName} onInput={(e) => (tenantName.value = value(e))} />
        </Field>
        <Field label="Tenant's email" hint="Invoices are emailed here." problem={p["tenant.email"]}>
          <input type="email" value={tenantEmail} onInput={(e) => (tenantEmail.value = value(e))} />
        </Field>
        <Field label="Tenant's phone (optional)">
          <input type="tel" value={tenantPhone} onInput={(e) => (tenantPhone.value = value(e))} />
        </Field>
        <h2>The rent</h2>
        <Field label="Monthly rent" hint="In kina, such as K1,200.00." problem={p["terms.rentToea"]}>
          <input inputMode="decimal" value={rent} onInput={(e) => (rent.value = value(e))} />
        </Field>
        <Field label="Day of the month to invoice" problem={p["terms.billingDay"]}>
          <input inputMode="numeric" value={billingDay} onInput={(e) => (billingDay.value = value(e))} />
        </Field>
        <Field label="Days the tenant has to pay" problem={p["terms.dueDays"]}>
          <input inputMode="numeric" value={dueDays} onInput={(e) => (dueDays.value = value(e))} />
        </Field>
        <Field label="Tenancy start date" problem={p["terms.startDate"]}>
          <input type="date" value={startDate} onInput={(e) => (startDate.value = value(e))} />
        </Field>
        <Field label="Payment reference" hint="A short code the tenant writes on the bank deposit, such as KILA." problem={p["terms.referenceCode"]}>
          <input value={reference} onInput={(e) => (reference.value = value(e))} />
        </Field>
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Save and finish</button>
      </form>
    </main>
  );
}

function prefix(pre: string, problems: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(problems).map(([k, v]) => [pre + k, v]));
}
