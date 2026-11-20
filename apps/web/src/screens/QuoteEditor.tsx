/**
 * Writing a quote (docs/PLAN-GENERAL-INVOICING.md §3.3, G2q-a): the customer, the lines
 * with GST as on an invoice, how long it holds, then Send quote. Sending saves the draft,
 * and sendQuote numbers, freezes, renders and emails it with the link to accept it.
 */
import { useSignal } from "@preact/signals";
import { DEFAULT_QUOTE_VALID_DAYS, type Problems, type QuoteDraft, quoteProblems } from "@sasimem/core";
import { type Outcome, type Setup, customerFrom } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { LinesEditor, type LineText, blankLine, readLine, textOf } from "./LinesEditor.js";
import { whole } from "./read.js";

type DraftField = keyof QuoteDraft;

export function QuoteEditor(props: {
  /** The saved draft's ID; null for a new quote. */
  id: string | null;
  draft: QuoteDraft | null;
  setup: Setup;
  onSave: (id: string | null, draft: QuoteDraft) => Promise<{ readonly id: string } | { readonly problem: string }>;
  onDelete: (id: string) => Promise<string | null>;
  onSend: (id: string) => Promise<Outcome>;
  onDone: () => void;
}) {
  const { org, tenants } = props.setup;
  const d = props.draft;
  const id = useSignal(props.id);
  const customerId = useSignal(d?.customerId ?? "");
  const lines = useSignal<readonly LineText[]>(d === null ? [blankLine()] : d.lines.map(textOf));
  const notes = useSignal(d?.notes ?? "");
  const validDays = useSignal(d?.validDays == null ? "" : String(d.validDays));
  const tried = useSignal(false);
  const problems = useSignal<Problems<DraftField>>({});
  const failure = useSignal<string | null>(null);
  const sent = useSignal<string | null>(null);
  const busy = useSignal(false);

  const customerDoc = tenants.find((t) => t.id === customerId.value);
  const customer = customerDoc === undefined ? null : customerFrom(customerDoc);
  const read = lines.value.map(readLine);
  const draft: QuoteDraft = {
    customerId: customerId.value,
    lines: read.map((r) => r.line),
    notes: notes.value.trim(),
    validDays: validDays.value.trim() === "" ? null : whole(validDays.value),
    revises: d?.revises ?? null,
  };

  /** Save as it stands; what stops a save is what could not be stored (unreadable numbers, lengths, days). */
  const save = async (): Promise<string | null> => {
    tried.value = true;
    const { notes: n, validDays: days } = quoteProblems(draft, customer);
    problems.value = { ...(n === undefined ? {} : { notes: n }), ...(days === undefined ? {} : { validDays: days }) };
    if (Object.keys(problems.value).length > 0 || read.some((r) => !r.readable)) return null;
    busy.value = true;
    const saved = await props.onSave(id.value, draft);
    busy.value = false;
    if ("problem" in saved) {
      failure.value = saved.problem;
      return null;
    }
    id.value = saved.id;
    return saved.id;
  };

  const saveDraft = async (e: Event) => {
    e.preventDefault();
    failure.value = null;
    if ((await save()) !== null) props.onDone();
  };

  const send = async () => {
    tried.value = true;
    failure.value = null;
    problems.value = quoteProblems(draft, customer);
    if (Object.keys(problems.value).length > 0 || !read.every((r) => r.readable)) return;
    const saved = await save();
    if (saved === null) return;
    busy.value = true;
    const outcome = await props.onSend(saved);
    busy.value = false;
    if (outcome.ok) sent.value = outcome.message;
    else failure.value = outcome.message;
  };

  const remove = async () => {
    if (id.value === null) return props.onDone();
    busy.value = true;
    failure.value = await props.onDelete(id.value);
    busy.value = false;
    if (failure.value === null) props.onDone();
  };

  if (sent.value !== null) {
    return (
      <main class="narrow">
        <Back href="/quotes" label="Quotes" />
        <h1>Sent</h1>
        <p role="status">{sent.value}</p>
        <p>The PDF went by email, with a link to accept the quote or decline it.</p>
        <p><a class="button" href="/quotes/new">Write another quote</a></p>
        <p><a href="/quotes">See your quotes</a></p>
      </main>
    );
  }

  const p = problems.value;
  return (
    <main class="narrow">
      <Back href="/quotes" label="Quotes" />
      <h1>{props.id === null ? "New quote" : "Edit draft quote"}</h1>
      <form onSubmit={saveDraft} noValidate>
        <Field label="Customer" problem={p.customerId}>
          <select value={customerId} onChange={(e) => (customerId.value = value(e))}>
            <option value="">Choose a customer</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {customer !== null && (
          <p class="note">Emailed to {customer.email}{customer.ccEmails.length > 0 && `, copy to ${customer.ccEmails.join(", ")}`}.</p>
        )}
        <p class="note"><a href="/tenants/new">Add a customer</a></p>

        <LinesEditor lines={lines} read={read} setup={props.setup} tried={tried.value} problem={p.lines} />

        <Field label="Days it is valid (optional)" hint={`Leave blank for your usual ${org.quoteValidDays ?? DEFAULT_QUOTE_VALID_DAYS} days.`} problem={p.validDays}>
          <input inputMode="numeric" value={validDays} onInput={(e) => (validDays.value = value(e))} />
        </Field>
        <Field label="Note on the quote (optional)" problem={p.notes}>
          <textarea rows={3} value={notes} onInput={(e) => (notes.value = value(e))} />
        </Field>
        <p class="note">Your quote terms print under the lines. Change them in <a href="/settings">Settings</a>.</p>

        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="button" disabled={busy} onClick={() => void send()}>Send quote</button>
        <button type="submit" class="quiet" disabled={busy}>Save draft</button>
        {id.value !== null && <button type="button" class="danger" disabled={busy} onClick={() => void remove()}>Delete this draft</button>}
      </form>
    </main>
  );
}
