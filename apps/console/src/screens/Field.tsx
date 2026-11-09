import type { JSX } from "preact";

/** A labelled input with its problem underneath. Labels wrap inputs, so tap targets are the whole row. */
export function Field(props: {
  label: string;
  problem?: string | undefined;
  hint?: string;
  children: JSX.Element;
}) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint !== undefined && <span class="field-hint">{props.hint}</span>}
      {props.problem !== undefined && <span class="field-problem">{props.problem}</span>}
    </label>
  );
}

export const value = (e: Event): string => (e.currentTarget as HTMLInputElement).value;
