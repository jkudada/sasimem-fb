/**
 * Writing a one-off invoice (docs/PLAN-GENERAL-INVOICING.md G2a): pick a customer, add
 * lines from the price list or typed, see the totals and GST as you type, then Send.
 * Sending is the say-so (D7): it saves the draft, and issueInvoice numbers, freezes,
 * renders and emails it. Every rule is core's; this screen only reads what was typed.
 * Send later (G2d) is the same say-so given ahead: the tick numbers and sends it on the day.
 */
import { useSignal } from "@preact/signals";
import {
  type CalendarDate, type ItemLineField, type ItemLineInput, type OneOffDraft, type Problems, type TaxCode, type Toea,
  addDays, draftProblems, dueDaysFor, formatKina, formatQuantity, hourLabel, itemLine, itemLineProblems, lineFromItem, MAX_LINES, parseQuantity,
  sendLaterLabel, sendLaterProblem, totals,
} from "@sasimem/core";
import { type Outcome, type ScheduledDraft, type Setup, customerFrom, newId } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { TAX_LABELS, priceOf } from "./Items.js";
import { readKina, whole } from "./read.js";

/** A line as typed: quantity and price stay text until read. */
interface LineText {
  readonly key: string;
  readonly description: string;
  readonly detail: string;
  readonly quantity: string;
  readonly unit: string;
  readonly price: string;
  readonly taxCode: TaxCode;
}

const textOf = (l: ItemLineInput): LineText => ({
  key: newId(), description: l.description, detail: l.detail, unit: l.unit, taxCode: l.taxCode,
  quantity: Number.isSafeInteger(l.quantityMilli) && l.quantityMilli > 0 ? formatQuantity(l.quantityMilli) : "",
  price: Number.isSafeInteger(l.unitPriceToea) ? formatKina(l.unitPriceToea) : "",
});

const blankLine = (): LineText => ({ key: newId(), description: "", detail: "", quantity: "1", unit: "", price: "", taxCode: "standard" });

/** A typed line as core's input, with what is wrong with it: unreadable numbers in our words, the rest in core's. */
function readLine(t: LineText): { line: ItemLineInput; problems: Problems<ItemLineField>; readable: boolean } {
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

type DraftField = keyof OneOffDraft;

export function InvoiceEditor(props: {
  /** The saved draft's ID; null for a new invoice. */
  id: string | null;
  /** The saved draft, with its schedule if it has one; null for a new invoice. */
  draft: ScheduledDraft | null;
  setup: Setup;
  today: CalendarDate;
  onSave: (id: string | null, draft: OneOffDraft) => Promise<{ readonly id: string } | { readonly problem: string }>;
  onDelete: (id: string) => Promise<string | null>;
  onSend: (id: string) => Promise<Outcome>;
  onSchedule: (id: string, sendOn: string) => Promise<Outcome>;
  onCancelSchedule: (id: string) => Promise<Outcome>;
  onDone: () => void;
}) {
  const { org, tenants } = props.setup;
  const items = props.setup.items ?? [];
  const d = props.draft;
  const id = useSignal(props.id);
  const customerId = useSignal(d?.customerId ?? "");
  const lines = useSignal<readonly LineText[]>(d === null ? [blankLine()] : d.lines.map(textOf));
  const poNumber = useSignal(d?.poNumber ?? "");
  const notes = useSignal(d?.notes ?? "");
  const dueDays = useSignal(d?.dueDays === null || d === null ? "" : String(d.dueDays));
  const tried = useSignal(false);
  const problems = useSignal<Problems<DraftField>>({});
  const failure = useSignal<string | null>(null);
  const done = useSignal<{ readonly heading: "Sent" | "Scheduled"; readonly message: string } | null>(null);
  const busy = useSignal(false);
  const schedule = useSignal(d?.sendLater ?? null);
  const sendOn = useSignal<string>(d?.sendLater?.sendOn ?? "");
  const sendOnProblem = useSignal<string | null>(null);
  const notice = useSignal<string | null>(null);
  /** Scheduled and still to go (not one the tick could not send). */
  const waiting = schedule.value !== null && schedule.value.problem === undefined;

  const customerDoc = tenants.find((t) => t.id === customerId.value);
  const customer = customerDoc === undefined ? null : customerFrom(customerDoc);
  const read = lines.value.map(readLine);
  const draft: OneOffDraft = {
    customerId: customerId.value,
    lines: read.map((r) => r.line),
    poNumber: poNumber.value.trim(),
    notes: notes.value.trim(),
    dueDays: dueDays.value.trim() === "" ? null : whole(dueDays.value),
  };
  const sum = totals(read.filter((r) => Object.keys(r.problems).length === 0).map((r) => itemLine(r.line, org)));

  const setLine = (key: string, change: Partial<LineText>) => {
    lines.value = lines.value.map((l) => (l.key === key ? { ...l, ...change } : l));
  };
  /** Add a line; an item picked first fills the blank line a new invoice starts with, rather than leaving it empty above. */
  const addLine = (l: LineText) => {
    const [only] = lines.value;
    if (lines.value.length === 1 && only !== undefined && only.description === "" && only.price === "") lines.value = [l];
    else if (lines.value.length < MAX_LINES) lines.value = [...lines.value, l];
  };

  /** Save as it stands; what stops a save is what could not be stored (unreadable numbers, lengths). */
  const save = async (): Promise<string | null> => {
    tried.value = true;
    const { poNumber: po, notes: n, dueDays: due } = draftProblems(draft, customer);
    // A missing order number can wait for Send; one too long cannot be stored.
    const storable: Problems<DraftField> = { ...(draft.poNumber.length > 40 ? { poNumber: po } : {}), ...(n === undefined ? {} : { notes: n }), ...(due === undefined ? {} : { dueDays: due }) };
    problems.value = storable;
    if (Object.keys(storable).length > 0 || read.some((r) => !r.readable)) return null;
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

  /** Everything Send checks; true when it may go. */
  const sendable = () => {
    tried.value = true;
    failure.value = null;
    problems.value = draftProblems(draft, customer);
    return Object.keys(problems.value).length === 0 && read.every((r) => r.readable);
  };

  const saveDraft = async (e: Event) => {
    e.preventDefault();
    failure.value = null;
    if (waiting && !sendable()) return; // a schedule never sits on a draft that cannot go
    if ((await save()) !== null) props.onDone();
  };

  /** Save, then hand the saved draft to `act`; its outcome is the screen's. */
  const saveThen = async (heading: "Sent" | "Scheduled", act: (id: string) => Promise<Outcome>) => {
    const saved = await save();
    if (saved === null) return;
    busy.value = true;
    const outcome = await act(saved);
    busy.value = false;
    if (outcome.ok) done.value = { heading, message: outcome.message };
    else failure.value = outcome.message;
  };

  const send = async () => {
    if (sendable()) await saveThen("Sent", props.onSend);
  };

  const scheduleIt = async () => {
    const ok = sendable();
    sendOnProblem.value = sendLaterProblem(sendOn.value, props.today);
    if (ok && sendOnProblem.value === null) await saveThen("Scheduled", (saved) => props.onSchedule(saved, sendOn.value.trim()));
  };

  const cancelSchedule = async () => {
    if (id.value === null) return;
    busy.value = true;
    const outcome = await props.onCancelSchedule(id.value);
    busy.value = false;
    if (outcome.ok) {
      schedule.value = null;
      notice.value = outcome.message;
    } else failure.value = outcome.message;
  };

  const remove = async () => {
    if (id.value === null) return props.onDone();
    busy.value = true;
    failure.value = await props.onDelete(id.value);
    busy.value = false;
    if (failure.value === null) props.onDone();
  };

  if (done.value !== null) {
    return (
      <main class="narrow">
        <Back href="/one-off" label="One-off invoices" />
        <h1>{done.value.heading}</h1>
        <p role="status">{done.value.message}</p>
        <p>{done.value.heading === "Sent" ? "The PDF went by email. When they pay, mark it paid from Still owed." : "It stays with your drafts until then, where you can change it or cancel the schedule."}</p>
        <p><a class="button" href="/one-off/new">Write another invoice</a></p>
        <p><a href="/one-off">See your one-off invoices</a></p>
      </main>
    );
  }

  const p = problems.value;
  const usual = dueDaysFor({ draft: null, customer: customer?.termsDays ?? null, org: org.defaultTermsDays });
  return (
    <main class="narrow">
      <Back href="/one-off" label="One-off invoices" />
      <h1>{props.id === null ? "New invoice" : "Edit draft invoice"}</h1>
      <form onSubmit={saveDraft} noValidate>
        <Field label="Customer" problem={p.customerId}>
          <select value={customerId} onChange={(e) => (customerId.value = value(e))}>
            <option value="">Choose a customer</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {customer !== null && (
          <p class="note">
            Emailed to {customer.email}{customer.ccEmails.length > 0 && `, copy to ${customer.ccEmails.join(", ")}`}.
            {customer.poRequired && " Pays only against an order number."}
          </p>
        )}
        <p class="note"><a href="/tenants/new">Add a customer</a></p>

        <h2>Lines</h2>
        {lines.value.map((t, i) => (
          <LineFields key={t.key} n={i + 1} text={t} gst={org.gstRegistered} problems={tried.value ? (read[i]?.problems ?? {}) : {}}
            onChange={(change) => setLine(t.key, change)}
            onRemove={lines.value.length > 1 ? () => (lines.value = lines.value.filter((l) => l.key !== t.key)) : undefined} />
        ))}
        {p.lines !== undefined && <p class="field-problem">{p.lines}</p>}
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

        <h2>For their accounts</h2>
        <Field label={customer?.poRequired === true ? "Their order number" : "Their order number (optional)"} hint="Their purchase order (PO), if they gave you one." problem={p.poNumber}>
          <input value={poNumber} onInput={(e) => (poNumber.value = value(e))} />
        </Field>
        <Field label="Days to pay (optional)" hint={`Leave blank for ${customer?.termsDays !== null && customer !== null ? "this customer's" : "your usual"} ${usual} days.`} problem={p.dueDays}>
          <input inputMode="numeric" value={dueDays} onInput={(e) => (dueDays.value = value(e))} />
        </Field>
        <Field label="Note on the invoice (optional)" problem={p.notes}>
          <textarea rows={3} value={notes} onInput={(e) => (notes.value = value(e))} />
        </Field>

        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="button" disabled={busy} onClick={() => void send()}>Send invoice</button>
        <button type="submit" class="quiet" disabled={busy}>Save draft</button>
        {id.value !== null && <button type="button" class="danger" disabled={busy} onClick={() => void remove()}>Delete this draft</button>}

        <fieldset class="card">
          <legend>Send later</legend>
          {waiting && schedule.value !== null && (
            <p role="status">Scheduled: it goes to {customer?.name ?? "the customer"} on {sendLaterLabel(schedule.value.sendOn, org.sendHour)}. It is numbered then.</p>
          )}
          {schedule.value?.problem !== undefined && (
            <p role="alert">This was due to go on {sendLaterLabel(schedule.value.sendOn, org.sendHour)}, but was not sent: {schedule.value.problem} Put it right, then send it or schedule it again.</p>
          )}
          {notice.value !== null && <p role="status">{notice.value}</p>}
          <Field label="Send on" hint={`It goes at ${hourLabel(org.sendHour)} that day, the hour you send invoices.`} problem={sendOnProblem.value ?? undefined}>
            <input type="date" min={addDays(props.today, 1)} value={sendOn} onInput={(e) => (sendOn.value = value(e))} />
          </Field>
          <button type="button" class="quiet" disabled={busy} onClick={() => void scheduleIt()}>Schedule</button>
          {schedule.value !== null && <button type="button" class="quiet" disabled={busy} onClick={() => void cancelSchedule()}>Cancel the schedule</button>}
        </fieldset>
      </form>
    </main>
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
