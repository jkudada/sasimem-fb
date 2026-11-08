/** One invoice template (docs/PLAN-TEMPLATES.md §4): layout, colour, font, letterhead and note, with a live sketch. */
import { useSignal } from "@preact/signals";
import { ACCENTS, CLASSIC, FONTS, type InvoiceTemplate, LAYOUTS, MARKS, MAX_FOOTER, templateDeleteProblem, templateProblems } from "@sasimem/core";
import type { Outcome, Setup } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { TemplateSketch } from "./TemplateSketch.js";
import { defaultTemplateOf } from "./Templates.js";

type Problems = ReturnType<typeof templateProblems>;

/** A group of radio buttons, one per option. */
function Choice<T extends string>(props: {
  legend: string; name: string; options: readonly { id: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void; problem?: string | undefined;
}) {
  return (
    <fieldset class="choices">
      <legend class="field-label">{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.id} class="check">
          <input type="radio" name={props.name} value={o.id} checked={props.value === o.id} onChange={() => props.onChange(o.id)} />
          <span>{o.label}{o.hint !== undefined && <span class="field-hint"> {o.hint}</span>}</span>
        </label>
      ))}
      {props.problem !== undefined && <span class="field-problem">{props.problem}</span>}
    </fieldset>
  );
}

export function TemplateForm(props: {
  id: string | null;
  setup: Setup;
  onSave: (id: string | null, template: InvoiceTemplate, makeDefault: boolean) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onPreview: (template: InvoiceTemplate) => Promise<Outcome>;
  onDone: () => void;
}) {
  const existing = props.id === null ? undefined : props.setup.templates.find((t) => t.id === props.id);
  const start = existing ?? { ...CLASSIC, name: "" };
  const isDefault = props.id !== null && defaultTemplateOf(props.setup) === props.id;
  // The default, or one a property or tenancy uses, is kept (rules cannot query; plan §3).
  const kept = props.id === null ? null
    : templateDeleteProblem(props.id, { defaultTemplateId: defaultTemplateOf(props.setup) ?? undefined, properties: props.setup.properties, tenancies: props.setup.tenancies });
  const name = useSignal(start.name);
  const layout = useSignal(start.layout);
  const accent = useSignal(start.accent);
  const font = useSignal(start.font);
  const mark = useSignal(start.mark);
  const footer = useSignal(start.footer);
  // A first template is usually meant for every invoice; after that, ask.
  const makeDefault = useSignal(props.id === null && defaultTemplateOf(props.setup) === null);
  const problems = useSignal<Problems>({});
  const message = useSignal<string | null>(null);
  const busy = useSignal(false);

  if (props.id !== null && existing === undefined) {
    return <main class="narrow"><Back href="/settings/templates" label="Templates" /><p>That template no longer exists.</p></main>;
  }

  const current = (): InvoiceTemplate => ({ name: name.value.trim(), layout: layout.value, accent: accent.value, font: font.value, mark: mark.value, footer: footer.value.trim() });

  const save = async (e: Event) => {
    e.preventDefault();
    const t = current();
    problems.value = templateProblems(t);
    message.value = null;
    if (Object.keys(problems.value).length > 0) return;
    busy.value = true;
    const problem = await props.onSave(props.id, t, makeDefault.value && !isDefault);
    busy.value = false;
    if (problem === null) props.onDone();
    else message.value = problem;
  };

  const preview = async () => {
    const t = { ...current(), name: current().name || "Sample" };
    problems.value = templateProblems(t);
    if (Object.keys(problems.value).length > 0) return;
    busy.value = true;
    message.value = (await props.onPreview(t)).message;
    busy.value = false;
  };

  const remove = async () => {
    if (props.id === null) return;
    busy.value = true;
    const problem = await props.onDelete(props.id);
    busy.value = false;
    if (problem === null) props.onDone();
    else message.value = problem;
  };

  const p = problems.value;
  return (
    <main class="narrow">
      <Back href="/settings/templates" label="Templates" />
      <h1>{existing === undefined ? "New template" : existing.name}</h1>
      <TemplateSketch template={current()} orgName={props.setup.org.name} hasLogo={props.setup.org.logoPath !== undefined} />
      <form onSubmit={save} noValidate>
        <Field label="Template name" hint="Only you see this, such as Shops or Houses." problem={p.name}>
          <input value={name} onInput={(e) => (name.value = value(e))} />
        </Field>
        <Choice legend="Layout" name="layout" options={LAYOUTS} value={layout.value} onChange={(v) => (layout.value = v)} problem={p.layout} />
        <fieldset class="choices">
          <legend class="field-label">Colour</legend>
          <div class="swatches">
            {ACCENTS.map((a) => (
              <label key={a.hex} class="swatch" style={{ background: a.hex }} title={a.label}>
                <input type="radio" name="accent" value={a.hex} aria-label={a.label} checked={accent.value === a.hex} onChange={() => (accent.value = a.hex)} />
              </label>
            ))}
          </div>
          {p.accent !== undefined && <span class="field-problem">{p.accent}</span>}
        </fieldset>
        <Choice legend="Font" name="font" options={FONTS} value={font.value} onChange={(v) => (font.value = v)} problem={p.font} />
        <Choice legend="Top left of the invoice" name="mark" options={MARKS} value={mark.value} onChange={(v) => (mark.value = v)} problem={p.mark} />
        <Field label="Note on every invoice (optional)" hint={`Up to ${MAX_FOOTER} characters, such as "Thank you. Rent is due on the 1st."`} problem={p.footer}>
          <textarea rows={3} value={footer} onInput={(e) => (footer.value = (e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
        {!isDefault && (
          <label class="check">
            <input type="checkbox" checked={makeDefault} onChange={(e) => (makeDefault.value = (e.currentTarget as HTMLInputElement).checked)} />
            Use this template for all my invoices
          </label>
        )}
        {message.value !== null && <p role="status">{message.value}</p>}
        <button type="submit" disabled={busy}>Save template</button>
        <button type="button" class="quiet" disabled={busy} onClick={() => void preview()}>See a sample PDF</button>
      </form>
      <p class="note">The sample PDF is a made-up invoice with your details and these settings. It downloads to your phone.</p>
      {existing !== undefined && (kept !== null
        ? <p class="note">{kept}</p>
        : <button type="button" class="danger" disabled={busy} onClick={() => void remove()}>Delete template</button>)}
    </main>
  );
}
