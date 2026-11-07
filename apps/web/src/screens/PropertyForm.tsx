import { useSignal } from "@preact/signals";
import { type PropertyInput, type Unit, type UseType, deleteProblem, propertyProblems, unitRemovalProblem } from "@sasimem/core";
import { newId, type Setup } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";

type Problems = ReturnType<typeof propertyProblems>;

/** Add or edit a property and its units. A unit someone rents can be renamed, not removed. */
export function PropertyForm(props: {
  id: string | null;
  setup: Setup;
  onSave: (id: string | null, property: PropertyInput) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const before = props.setup.properties.find((p) => p.id === props.id);
  const address = useSignal(before?.address ?? "");
  const useType = useSignal<UseType>(before?.useType ?? "residential");
  const units = useSignal<readonly Unit[]>(before?.units ?? [{ id: newId(), label: "Whole property" }]);
  const problems = useSignal<Problems>({});
  const failure = useSignal<string | null>(null);
  const busy = useSignal(false);

  const setLabel = (id: string, label: string) => (units.value = units.value.map((u) => (u.id === id ? { ...u, label } : u)));

  const submit = async (e: Event) => {
    e.preventDefault();
    const property: PropertyInput = { address: address.value.trim(), useType: useType.value, units: units.value.map((u) => ({ ...u, label: u.label.trim() })) };
    const found: Problems = { ...propertyProblems(property) };
    const removal = before === undefined ? null : unitRemovalProblem(before.id, before, property, props.setup.tenancies);
    if (removal !== null) found.units = removal;
    problems.value = found;
    failure.value = null;
    if (Object.keys(found).length > 0) return;
    await run(() => props.onSave(props.id, property));
  };

  const remove = async () => {
    if (props.id === null) return;
    const id = props.id;
    const blocked = deleteProblem({ propertyId: id }, props.setup.tenancies);
    if (blocked !== null) {
      failure.value = blocked;
      return;
    }
    await run(() => props.onDelete(id));
  };

  const run = async (act: () => Promise<string | null>) => {
    busy.value = true;
    failure.value = await act();
    busy.value = false;
    if (failure.value === null) props.onDone();
  };

  const p = problems.value;
  return (
    <main class="narrow">
      <Back href="/properties" label="Properties" />
      <h1>{before === undefined ? "Add a property" : "Edit property"}</h1>
      <form onSubmit={submit} noValidate>
        <Field label="Property address" problem={p.address}>
          <input value={address} onInput={(e) => (address.value = value(e))} />
        </Field>
        <fieldset>
          <legend>What is it used for?</legend>
          <label class="check"><input type="radio" name="use" checked={useType.value === "residential"} onChange={() => (useType.value = "residential")} /> Someone lives there</label>
          <label class="check"><input type="radio" name="use" checked={useType.value === "commercial"} onChange={() => (useType.value = "commercial")} /> A business uses it</label>
          <span class="field-hint">Rent on a business property has GST added if you are registered; rent on a home does not.</span>
        </fieldset>
        <fieldset>
          <legend>Units</legend>
          {units.value.map((u, i) => (
            <div class="row" key={u.id}>
              <Field label={`Unit ${i + 1} name`}>
                <input value={u.label} onInput={(e) => setLabel(u.id, value(e))} />
              </Field>
              {units.value.length > 1 && (
                <button type="button" class="quiet small" aria-label={`Remove ${u.label}`} onClick={() => (units.value = units.value.filter((x) => x.id !== u.id))}>Remove</button>
              )}
            </div>
          ))}
          {p.units !== undefined && <span class="field-problem">{p.units}</span>}
          <button type="button" class="quiet" onClick={() => (units.value = [...units.value, { id: newId(), label: "" }])}>Add a unit</button>
        </fieldset>
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Save</button>
        {before !== undefined && <button type="button" class="danger" disabled={busy} onClick={() => void remove()}>Delete this property</button>}
      </form>
    </main>
  );
}
