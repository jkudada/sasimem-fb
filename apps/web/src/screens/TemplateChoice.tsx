import type { Signal } from "@preact/signals";
import type { Setup } from "../setup.js";
import { Field, value } from "./Field.js";

/** The id to start a form with: "" (use the default) when unset or the template is gone. */
export const knownTemplate = (setup: Setup, id: string | undefined): string =>
  id !== undefined && setup.templates.some((t) => t.id === id) ? id : "";

/**
 * "Template" on the property and tenancy forms (docs/PLAN-TEMPLATES.md §4): "Use default"
 * first, naming what that is, then the org's templates. Hidden until there is a template.
 */
export function TemplateChoice(props: { setup: Setup; value: Signal<string>; fallsBackTo: string; hint: string }) {
  if (props.setup.templates.length === 0) return null;
  return (
    <Field label="Invoice template" hint={props.hint}>
      <select value={props.value} onChange={(e) => (props.value.value = value(e))}>
        <option value="">Use default ({props.fallsBackTo})</option>
        {props.setup.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </Field>
  );
}
