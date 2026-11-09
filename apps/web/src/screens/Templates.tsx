/**
 * Invoice templates (docs/PLAN-TEMPLATES.md §4): the default first, then the rest by
 * name, and built-in Classic, which is the default until another is chosen.
 */
import { useSignal } from "@preact/signals";
import { ACCENTS, CLASSIC, type InvoiceTemplate, LAYOUTS, MAX_TEMPLATES } from "@sasimem/core";
import type { Setup } from "../setup.js";
import { Back } from "./Back.js";

/** "Band · Ocean · Traditional": the template in words, beside a dot of its colour. */
export const describeTemplate = (t: InvoiceTemplate): string => [
  LAYOUTS.find((l) => l.id === t.layout)?.label ?? t.layout,
  ACCENTS.find((a) => a.hex === t.accent)?.label ?? t.accent,
  t.font === "times" ? "Traditional" : "Modern",
].join(" · ");

/** The id of the template new invoices use, or null for built-in Classic (also when the default was deleted). */
export const defaultTemplateOf = (setup: Setup): string | null => {
  const id = setup.org.defaultTemplateId;
  return id !== undefined && setup.templates.some((t) => t.id === id) ? id : null;
};

export function Templates(props: { setup: Setup; onSetDefault: (id: string | null) => Promise<string | null> }) {
  const { setup } = props;
  const busy = useSignal(false);
  const message = useSignal<string | null>(null);
  const current = defaultTemplateOf(setup);
  const rows = [
    ...setup.templates.map((t) => ({ id: t.id as string | null, template: t, builtIn: false })),
    { id: null, template: CLASSIC, builtIn: true },
  ].sort((a, b) => Number(b.id === current) - Number(a.id === current)); // stable: the default first, the rest as they were

  const makeDefault = async (id: string | null, name: string) => {
    busy.value = true;
    message.value = (await props.onSetDefault(id)) ?? `${name} is now your default. Invoices you approve from now on use it.`;
    busy.value = false;
  };

  return (
    <main class="narrow">
      <Back href="/settings" label="Settings" />
      <h1>Invoice templates</h1>
      <p class="note">Choose how your invoices look. Your default is used for every tenant. Invoices you have already approved keep the look they were issued with.</p>
      {message.value !== null && <p role="status">{message.value}</p>}
      {rows.map((r) => {
        const name = r.builtIn ? "Classic (built in)" : r.template.name;
        return (
          <section key={r.id ?? "classic"} class="card template" aria-label={name}>
            <span class="dot" style={{ background: r.template.accent }} aria-hidden="true" />
            <div>
              <h2>{name}</h2>
              <p class="note">{describeTemplate(r.template)}</p>
              {r.id === current ? <p class="state current">Default: used for every invoice</p> : (
                <button type="button" class="small quiet" disabled={busy} onClick={() => void makeDefault(r.id, name)}>Make default</button>
              )}
              {!r.builtIn && <a href={`/settings/templates/${r.id ?? ""}`}>Edit {r.template.name}</a>}
            </div>
          </section>
        );
      })}
      {setup.templates.length < MAX_TEMPLATES
        ? <a class="button" href="/settings/templates/new">New template</a>
        : <p class="note">You have {MAX_TEMPLATES} templates, the most you can keep. Delete one to add another.</p>}
    </main>
  );
}
