/**
 * The lines of a one-off invoice or a quote (G2a, G2q): each line as typed, the price list
 * to add from, and the totals with GST as you type. Both editors keep the lines in a
 * signal and read them with readLine; every rule is core's.
 */
import type { Signal } from "@preact/signals";
import {
  type ItemLineField, type ItemLineInput, type Problems, type TaxCode, type Toea,
  formatKina, formatQuantity, itemLine, itemLineProblems, lineFromItem, MAX_LINES, parseQuantity, totals,
} from "@sasimem/core";
import { type Setup, newId } from "../setup.js";
import { Field, value } from "./Field.js";
import { TAX_LABELS, priceOf } from "./Items.js";
import { readKina } from "./read.js";

/** A line as typed: quantity and price stay text until read. */
export interface LineText {
  readonly key: string;
  readonly description: string;
  readonly detail: string;
  readonly quantity: string;
  readonly unit: string;
  readonly price: string;
  readonly taxCode: TaxCode;
}

export const textOf = (l: ItemLineInput): LineText => ({
  key: newId(), description: l.description, detail: l.detail, unit: l.unit, taxCode: l.taxCode,
  quantity: Number.isSafeInteger(l.quantityMilli) && l.quantityMilli > 0 ? formatQuantity(l.quantityMilli) : "",
  price: Number.isSafeInteger(l.unitPriceToea) ? formatKina(l.unitPriceToea) : "",
});

export const blankLine = (): LineText => ({ key: newId(), description: "", detail: "", quantity: "1", unit: "", price: "", taxCode: "standard" });

export interface ReadLine {
  readonly line: ItemLineInput;
  readonly problems: Problems<ItemLineField>;
  /** False when a number could not be read: such a line cannot be stored. */
  readonly readable: boolean;
}

/** A typed line as core's input, with what is wrong with it: unreadable numbers in our words, the rest in core's. */
export function readLine(t: LineText): ReadLine {
  const q = parseQuantity(t.quantity);
  const price = readKina(t.price);
  const line: ItemLineInput = {
    description: t.description.trim(), detail: t.detail.trim(), unit: t.unit.trim(), taxCode: t.taxCode,
    quantityMilli: typeof q === "number" ? q : Number.NaN,
    unitPriceToea: "toea" in price ? price.toea : (Number.NaN as Toea),
  };
  const unreadable = {
    ...(typeof q === "number" ? {} : { quantity: q.problem }),
    ...("toea" in price ? {} : { unitPrice: price.problem }),
  };
  return { line, problems: { ...itemLineProblems(line), ...unreadable }, readable: Object.keys(unreadable).length === 0 };
}

export function LinesEditor(props: {
  lines: Signal<readonly LineText[]>;
  read: readonly ReadLine[];
  setup: Setup;
  /** Show each line's problems (after the first Save or Send). */
  tried: boolean;
  /** core's problem with the lines as a whole. */
  problem: string | undefined;
}) {
  const { lines, read } = props;
  const { org } = props.setup;
  const items = props.setup.items ?? [];
  const sum = totals(read.filter((r) => Object.keys(r.problems).length === 0).map((r) => itemLine(r.line, org)));

  const setLine = (key: string, change: Partial<LineText>) => {
    lines.value = lines.value.map((l) => (l.key === key ? { ...l, ...change } : l));
  };
  /** Add a line; an item picked first fills the blank line a new one starts with, rather than leaving it empty above. */
  const addLine = (l: LineText) => {
    const [only] = lines.value;
    if (lines.value.length === 1 && only !== undefined && only.description === "" && only.price === "") lines.value = [l];
    else if (lines.value.length < MAX_LINES) lines.value = [...lines.value, l];
  };

  return (
    <>
      <h2>Lines</h2>
      {lines.value.map((t, i) => (
        <LineFields key={t.key} n={i + 1} text={t} gst={org.gstRegistered} problems={props.tried ? (read[i]?.problems ?? {}) : {}}
          onChange={(change) => setLine(t.key, change)}
          onRemove={lines.value.length > 1 ? () => (lines.value = lines.value.filter((l) => l.key !== t.key)) : undefined} />
      ))}
      {props.problem !== undefined && <p class="field-problem">{props.problem}</p>}
      {lines.value.length < MAX_LINES && (
        <div class="line-add">
          {items.length > 0 && (
            <Field label="Add from your price list">
              <select value="" onChange={(e) => {
                const item = items.find((x) => x.id === value(e));
                if (item !== undefined) addLine(textOf(lineFromItem(item)));
                (e.currentTarget as HTMLSelectElement).value = "";
              }}>
                <option value="">Choose an item</option>
                {items.map((x) => <option key={x.id} value={x.id}>{x.name} · {priceOf(x)}</option>)}
              </select>
            </Field>
          )}
          <button type="button" class="quiet" onClick={() => addLine(blankLine())}>Add a line</button>
        </div>
      )}

      <dl class="totals" aria-label="Totals">
        <dt>Subtotal</dt><dd>{formatKina(sum.subtotalToea)}</dd>
        {org.gstRegistered && <><dt>GST</dt><dd>{formatKina(sum.gstToea)}</dd></>}
        <dt>Total</dt><dd><strong>{formatKina(sum.totalToea)}</strong></dd>
      </dl>
    </>
  );
}

function LineFields(props: {
  n: number;
  text: LineText;
  gst: boolean;
  problems: Problems<ItemLineField>;
  onChange: (change: Partial<LineText>) => void;
  onRemove: (() => void) | undefined;
}) {
  const t = props.text;
  const p = props.problems;
  return (
    <fieldset class="card line">
      <legend>Line {props.n}</legend>
      <Field label="What for" problem={p.description}>
        <input value={t.description} onInput={(e) => props.onChange({ description: value(e) })} />
      </Field>
      <Field label="Detail (optional)" problem={p.detail}>
        <input value={t.detail} onInput={(e) => props.onChange({ detail: value(e) })} />
      </Field>
      <div class="line-numbers">
        <Field label="Quantity" problem={p.quantity}>
          <input inputMode="decimal" value={t.quantity} onInput={(e) => props.onChange({ quantity: value(e) })} />
        </Field>
        <Field label="Unit" problem={p.unit}>
          <input value={t.unit} onInput={(e) => props.onChange({ unit: value(e) })} />
        </Field>
        <Field label="Price each" problem={p.unitPrice}>
          <input inputMode="decimal" value={t.price} onInput={(e) => props.onChange({ price: value(e) })} />
        </Field>
      </div>
      {props.gst && (
        <Field label="GST" problem={p.taxCode}>
          <select value={t.taxCode} onChange={(e) => props.onChange({ taxCode: value(e) as TaxCode })}>
            {(Object.keys(TAX_LABELS) as TaxCode[]).map((c) => <option key={c} value={c}>{TAX_LABELS[c]}</option>)}
          </select>
        </Field>
      )}
      {props.onRemove !== undefined && <button type="button" class="quiet small" onClick={props.onRemove}>Remove line {props.n}</button>}
    </fieldset>
  );
}
