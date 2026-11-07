import { type Signal, signal, useSignal } from "@preact/signals";
import {
  type CalendarDate, type Charge, type GstTreatment, type Period, type Recurrence, type TenancyInput, type Toea,
  chargeProblems, chargesProblem, formatKina, newTenancyDocument, sameAsRentLabel, tenancyProblems,
  type TenancyDocument,
} from "@sasimem/core";
import { newId, type Setup, type TenancyEdit } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { prefix, readKina, whole } from "./read.js";

/**
 * A charge as its row holds it, one signal per field: typing updates that input
 * alone, rather than re-rendering the whole form on every keystroke (it matters on
 * a mid-range phone). The amount is still the text typed.
 */
interface ChargeRow {
  readonly id: string;
  readonly description: Signal<string>;
  readonly amount: Signal<string>;
  readonly recurrence: Signal<Recurrence>;
  readonly period: Signal<string>;
  readonly active: Signal<boolean>;
  readonly gstTreatment: Signal<GstTreatment>;
}

const rowOf = (c: Omit<Charge, "amountToea" | "period"> & { amount: string; period: string }): ChargeRow => ({
  id: c.id, description: signal(c.description), amount: signal(c.amount), recurrence: signal(c.recurrence),
  period: signal(c.period), active: signal(c.active), gstTreatment: signal(c.gstTreatment),
});
const toRow = (c: Charge): ChargeRow => rowOf({ ...c, amount: formatKina(c.amountToea), period: c.period ?? "" });
const blankRow = (): ChargeRow => rowOf({ id: newId(), description: "", amount: "", recurrence: "every", period: "", active: true, gstTreatment: "inherit" });

type Problems = Record<string, string | undefined>;

/** Read the charge rows; problems keyed "extras.{i}.{field}". */
function readCharges(rows: readonly ChargeRow[]): { extras: Charge[]; problems: Problems } {
  const problems: Problems = {};
  const extras = rows.map((row, i): Charge => {
    const amount = readKina(row.amount.value);
    const period = row.recurrence.value === "one" ? row.period.value.trim() : null;
    const input = {
      description: row.description.value.trim(), amountToea: "toea" in amount ? amount.toea : (0 as Toea),
      recurrence: row.recurrence.value, period, active: row.active.value, gstTreatment: row.gstTreatment.value,
    };
    Object.assign(problems, prefix(`extras.${i}.`, chargeProblems(input)));
    if ("problem" in amount) problems[`extras.${i}.amountToea`] = amount.problem;
    return { id: row.id, ...input, period: period as Period | null };
  });
  const tooMany = chargesProblem(extras);
  if (tooMany !== null) problems["extras"] = tooMany;
  return { extras, problems };
}

/** Add or edit a tenancy, with its additional charges (plan §7, screen 4). */
export function TenancyForm(props: {
  id: string | null;
  setup: Setup;
  today: CalendarDate;
  onCreate: (tenancy: TenancyDocument) => Promise<string | null>;
  onUpdate: (id: string, edit: TenancyEdit) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const { properties, tenants, org } = props.setup;
  const before = props.setup.tenancies.find((t) => t.id === props.id);
  const propertyId = useSignal(before?.propertyId ?? properties[0]?.id ?? "");
  const property = properties.find((p) => p.id === propertyId.value);
  const unitId = useSignal(before?.unitId ?? property?.units[0]?.id ?? "");
  const tenantId = useSignal(before?.tenantId ?? tenants[0]?.id ?? "");
  const rent = useSignal(before === undefined ? "" : formatKina(before.rentToea));
  const billingDay = useSignal(String(before?.billingDay ?? 1));
  const dueDays = useSignal(String(before?.dueDays ?? 7));
  const startDate = useSignal<string>(before?.startDate ?? props.today);
  const endDate = useSignal(before?.endDate ?? "");
  const reference = useSignal(before?.referenceCode ?? "");
  const charges = useSignal<readonly ChargeRow[]>(before?.extras.map(toRow) ?? []);
  const problems = useSignal<Problems>({});
  const failure = useSignal<string | null>(null);
  const busy = useSignal(false);

  if (before === undefined && (properties.length === 0 || tenants.length === 0)) {
    return (
      <main class="narrow">
        <Back href="/" label="Home" />
        <h1>Add a tenancy</h1>
        <p>A tenancy joins a tenant to a unit. Add {properties.length === 0 ? <a href="/properties/new">a property</a> : <a href="/tenants/new">a tenant</a>} first.</p>
      </main>
    );
  }

  const useType = before?.useType ?? property?.useType ?? "residential";

  const run = async (act: () => Promise<string | null>) => {
    busy.value = true;
    failure.value = await act();
    busy.value = false;
    if (failure.value === null) props.onDone();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const rentRead = readKina(rent.value);
    const terms: TenancyInput = {
      rentToea: "toea" in rentRead ? rentRead.toea : (0 as Toea),
      startDate: startDate.value.trim(), endDate: endDate.value.trim() === "" ? null : endDate.value.trim(),
      billingDay: whole(billingDay.value), dueDays: whole(dueDays.value), referenceCode: reference.value.trim(),
    };
    const { extras, problems: chargeFound } = readCharges(charges.value);
    const found: Problems = { ...prefix("terms.", tenancyProblems(terms)), ...chargeFound };
    if ("problem" in rentRead) found["terms.rentToea"] = rentRead.problem;
    problems.value = found;
    failure.value = null;
    if (Object.values(found).some((v) => v !== undefined)) return;

    if (before !== undefined) {
      const edit: TenancyEdit = { ...terms, referenceCode: terms.referenceCode.toUpperCase(), extras };
      await run(() => props.onUpdate(before.id, edit));
      return;
    }
    const tenant = tenants.find((t) => t.id === tenantId.value);
    if (property === undefined || tenant === undefined) return;
    const doc = newTenancyDocument({ propertyId: property.id, property, unitId: unitId.value, tenantId: tenant.id, tenant, terms });
    await run(() => props.onCreate({ ...doc, extras }));
  };

  const remove = async () => {
    if (before !== undefined && !before.invoiced) await run(() => props.onDelete(before.id));
  };

  const p = problems.value;
  return (
    <main class="narrow">
      <Back href="/properties" label="Properties" />
      <h1>{before === undefined ? "Add a tenancy" : before.tenantName}</h1>
      {before !== undefined && <p class="note">{before.unitLabel}, {before.propertyAddress}</p>}
      <form onSubmit={submit} noValidate>
        {before === undefined && (
          <>
            <Field label="Property">
              <select value={propertyId} onChange={(e) => {
                propertyId.value = value(e);
                unitId.value = properties.find((x) => x.id === propertyId.value)?.units[0]?.id ?? "";
              }}>
                {properties.map((x) => <option key={x.id} value={x.id}>{x.address}</option>)}
              </select>
            </Field>
            <Field label="Unit">
              <select value={unitId} onChange={(e) => (unitId.value = value(e))}>
                {property?.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </Field>
            <Field label="Tenant">
              <select value={tenantId} onChange={(e) => (tenantId.value = value(e))}>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Monthly rent" hint="In kina, such as K1,200.00." problem={p["terms.rentToea"]}>
          <input inputMode="decimal" value={rent} onInput={(e) => (rent.value = value(e))} />
        </Field>
        <Field label="Day of the month to invoice" hint="The 31st means the last day in shorter months." problem={p["terms.billingDay"]}>
          <input inputMode="numeric" value={billingDay} onInput={(e) => (billingDay.value = value(e))} />
        </Field>
        <Field label="Days the tenant has to pay" problem={p["terms.dueDays"]}>
          <input inputMode="numeric" value={dueDays} onInput={(e) => (dueDays.value = value(e))} />
        </Field>
        <Field label="Tenancy start date" problem={p["terms.startDate"]}>
          <input type="date" value={startDate} onInput={(e) => (startDate.value = value(e))} />
        </Field>
        <Field label="End date (optional)" hint="Set this when the tenant leaves. No invoices after it." problem={p["terms.endDate"]}>
          <input type="date" value={endDate} onInput={(e) => (endDate.value = value(e))} />
        </Field>
        <Field label="Payment reference" hint="A short code the tenant writes on the bank deposit, such as KILA." problem={p["terms.referenceCode"]}>
          <input value={reference} onInput={(e) => (reference.value = value(e))} />
        </Field>

        <h2>Additional charges</h2>
        <p class="note">Water, power, a levy, or a credit (use a minus sign). Sasimem works out GST for you, but it is a tool, not an accountant.</p>
        {charges.value.map((c, i) => (
          <ChargeFields key={c.id} row={c} n={i + 1} problems={p} index={i}
            sameAsRent={sameAsRentLabel({ orgGstRegistered: org.gstRegistered, useType })}
            onRemove={() => (charges.value = charges.value.filter((x) => x.id !== c.id))} />
        ))}
        {p["extras"] !== undefined && <p class="field-problem">{p["extras"]}</p>}
        <button type="button" class="quiet" onClick={() => (charges.value = [...charges.value, blankRow()])}>Add a charge</button>

        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Save</button>
        {before !== undefined && (before.invoiced
          ? <p class="note">This tenancy has been invoiced, so it can be ended but not deleted. Set an end date instead.</p>
          : <button type="button" class="danger" disabled={busy} onClick={() => void remove()}>Delete this tenancy</button>)}
      </form>
    </main>
  );
}

/** One charge's fields. Only "how often" re-renders the row (it shows or hides the month). */
function ChargeFields(props: { row: ChargeRow; n: number; index: number; problems: Problems; sameAsRent: string; onRemove: () => void }) {
  const { row: c, n } = props;
  const at = (f: string) => props.problems[`extras.${props.index}.${f}`];
  return (
    <fieldset class="card">
      <legend>Charge {n}</legend>
      <Field label={`Charge ${n} description`} problem={at("description")}>
        <input value={c.description} onInput={(e) => (c.description.value = value(e))} />
      </Field>
      <Field label={`Charge ${n} amount`} hint="In kina; -K20.00 for a credit." problem={at("amountToea")}>
        <input inputMode="decimal" value={c.amount} onInput={(e) => (c.amount.value = value(e))} />
      </Field>
      <Field label={`Charge ${n} how often`}>
        <select value={c.recurrence} onChange={(e) => (c.recurrence.value = value(e) as Recurrence)}>
          <option value="every">Every month</option>
          <option value="one">One month only</option>
        </select>
      </Field>
      {c.recurrence.value === "one" && (
        <Field label={`Charge ${n} month`} problem={at("period")}>
          <input type="month" value={c.period} onInput={(e) => (c.period.value = value(e))} />
        </Field>
      )}
      <Field label={`Charge ${n} GST`}>
        <select value={c.gstTreatment} onChange={(e) => (c.gstTreatment.value = value(e) as GstTreatment)}>
          <option value="inherit">{props.sameAsRent}</option>
          <option value="taxable">GST added</option>
          <option value="exempt">No GST</option>
        </select>
      </Field>
      <label class="check">
        <input type="checkbox" aria-label={`Charge ${n} paused`} checked={!c.active.value} onChange={(e) => (c.active.value = !(e.currentTarget as HTMLInputElement).checked)} />
        Paused (not charged until you untick this)
      </label>
      <button type="button" class="quiet small" aria-label={`Remove charge ${n}`} onClick={props.onRemove}>Remove</button>
    </fieldset>
  );
}
