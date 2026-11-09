/** Radio pickers shared by the template editor and the logo builder. */
import type { ComponentChildren } from "preact";

export function Choice<T extends string>(props: {
  legend: string; name: string; options: readonly { id: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void;
  problem?: string | undefined; render?: (id: T, label: string) => ComponentChildren;
}) {
  return (
    <fieldset class="choices">
      <legend class="field-label">{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.id} class="check">
          <input type="radio" name={props.name} value={o.id} checked={props.value === o.id} onChange={() => props.onChange(o.id)} />
          <span>{props.render?.(o.id, o.label) ?? o.label}{o.hint !== undefined && <span class="field-hint"> {o.hint}</span>}</span>
        </label>
      ))}
      {props.problem !== undefined && <span class="field-problem">{props.problem}</span>}
    </fieldset>
  );
}

/** Colour swatches; each radio is named for its colour, for screen readers and tests. */
export function Swatches(props: {
  legend: string; name: string; colours: readonly { hex: string; label: string }[]; value: string; onChange: (hex: string) => void; problem?: string | undefined;
}) {
  return (
    <fieldset class="choices">
      <legend class="field-label">{props.legend}</legend>
      <div class="swatches">
        {props.colours.map((c) => (
          <label key={c.hex} class={c.hex === "#ffffff" ? "swatch light" : "swatch"} style={{ background: c.hex }} title={c.label}>
            <input type="radio" name={props.name} value={c.hex} aria-label={c.label} checked={props.value === c.hex} onChange={() => props.onChange(c.hex)} />
          </label>
        ))}
      </div>
      {props.problem !== undefined && <span class="field-problem">{props.problem}</span>}
    </fieldset>
  );
}
