/**
 * The price list (docs/PLAN-GENERAL-INVOICING.md G2a): services, materials and labour
 * rates an owner adds to an invoice in one tap. A line copied from an item is the
 * invoice's own: changing an item later never changes an invoice.
 */
import { useSignal } from "@preact/signals";
import { type Item, type TaxCode, formatKina, itemProblems } from "@sasimem/core";
import type { Setup } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { readKina } from "./read.js";

export const TAX_LABELS: Readonly<Record<TaxCode, string>> = {
  standard: "GST at 10%",
  exempt: "Exempt from GST",
  zero: "Zero-rated (0%)",
};

/** "K80.00 per hour", or "K80.00" with no unit. */
export const priceOf = (i: Pick<Item, "unitPriceToea" | "unit">): string => `${formatKina(i.unitPriceToea)}${i.unit === "" ? "" : ` per ${i.unit}`}`;

export function Items(props: { setup: Setup }) {
  const items = props.setup.items ?? [];
  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Price list</h1>
      <p class="lede">Your services, materials and rates. Add one to an invoice in one tap, then change it there if this job is different.</p>
      {items.length === 0 && <p>Nothing on your price list yet.</p>}
      <ul class="links">
        {items.map((i) => (
          <li key={i.id}>
            <a href={`/items/${i.id}`}>{i.name}</a>
            <span class="note">{priceOf(i)}</span>
          </li>
        ))}
      </ul>
      <a class="button" href="/items/new">Add an item</a>
    </main>
  );
}

type Problems = ReturnType<typeof itemProblems>;

export function ItemForm(props: {
  id: string | null;
  setup: Setup;
  onSave: (id: string | null, item: Item) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const before = props.setup.items?.find((i) => i.id === props.id);
  const name = useSignal(before?.name ?? "");
  const description = useSignal(before?.description ?? "");
  const unit = useSignal(before?.unit ?? "");
  const price = useSignal(before === undefined ? "" : formatKina(before.unitPriceToea));
  const taxCode = useSignal<TaxCode>(before?.taxCode ?? "standard");
  const problems = useSignal<Problems>({});
  const failure = useSignal<string | null>(null);
  const busy = useSignal(false);
  const gst = props.setup.org.gstRegistered;

  const run = async (act: () => Promise<string | null>) => {
    busy.value = true;
    failure.value = await act();
    busy.value = false;
    if (failure.value === null) props.onDone();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    failure.value = null;
    const read = readKina(price.value);
    const item: Item = {
      name: name.value.trim(), description: description.value.trim(), unit: unit.value.trim(),
      unitPriceToea: "toea" in read ? read.toea : (Number.NaN as Item["unitPriceToea"]), taxCode: taxCode.value,
    };
    problems.value = { ...itemProblems(item), ...("problem" in read ? { unitPriceToea: read.problem } : {}) };
    if (Object.keys(problems.value).length > 0) return;
    await run(() => props.onSave(props.id, item));
  };

  const p = problems.value;
  return (
    <main class="narrow">
      <Back href="/items" label="Price list" />
      <h1>{before === undefined ? "Add an item" : "Edit item"}</h1>
      <form onSubmit={submit} noValidate>
        <Field label="Item name" hint="As it prints on the invoice, like Labour or Cable 2.5mm." problem={p.name}>
          <input value={name} onInput={(e) => (name.value = value(e))} />
        </Field>
        <Field label="Description (optional)" hint="Printed under the name." problem={p.description}>
          <input value={description} onInput={(e) => (description.value = value(e))} />
        </Field>
        <Field label="Price" hint="For one unit, like K80.00." problem={p.unitPriceToea}>
          <input inputMode="decimal" value={price} onInput={(e) => (price.value = value(e))} />
        </Field>
        <Field label="Unit (optional)" hint="Like hour, m or each." problem={p.unit}>
          <input value={unit} onInput={(e) => (unit.value = value(e))} />
        </Field>
        {gst && (
          <Field label="GST" problem={p.taxCode}>
            <select value={taxCode} onChange={(e) => (taxCode.value = value(e) as TaxCode)}>
              {(Object.keys(TAX_LABELS) as TaxCode[]).map((c) => <option key={c} value={c}>{TAX_LABELS[c]}</option>)}
            </select>
          </Field>
        )}
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Save</button>
        {props.id !== null && <button type="button" class="danger" disabled={busy} onClick={() => void run(() => props.onDelete(props.id ?? ""))}>Delete this item</button>}
      </form>
    </main>
  );
}
