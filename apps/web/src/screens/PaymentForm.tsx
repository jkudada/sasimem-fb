/**
 * Recording a payment (docs/PLAN-GENERAL-INVOICING.md AR-5, AR-10; G2b): who paid, how
 * much, when and how; which invoices it pays, proposed oldest first and changeable; what
 * is left over is credit. Pressing Record is the say-so for the receipt email too.
 */
import { useSignal } from "@preact/signals";
import {
  type CalendarDate, type OpenInvoice, type PaymentInput, type PaymentMethod, type Toea,
  METHOD_LABELS, PAYMENT_METHODS, balanceOf, creditOf, dateLabel, formatKina, oldestFirst, paymentProblems,
} from "@sasimem/core";
import type { Outcome, OwedInvoice, Setup } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { readKina } from "./read.js";

type Problems = ReturnType<typeof paymentProblems>;

const asOpen = (i: OwedInvoice): OpenInvoice => ({
  id: i.id, number: i.number ?? "", customerId: i.tenantId, status: i.status, dueDate: i.dueDate, totalToea: i.totalToea,
  ...(i.amountPaidToea === undefined ? {} : { amountPaidToea: i.amountPaidToea }),
});

export function PaymentForm(props: {
  setup: Setup;
  /** Every sent, unpaid invoice (from Still owed). */
  owed: readonly OwedInvoice[];
  today: CalendarDate;
  /** Preselected from Still owed's "Record a payment". */
  customerId?: string;
  /** Unused credit per customer, to show beside them. */
  credit?: ReadonlyMap<string, number>;
  paymentId: string;
  onRecord: (paymentId: string, payment: PaymentInput, emailReceipt: boolean) => Promise<Outcome>;
}) {
  const customerId = useSignal(props.customerId ?? "");
  const amount = useSignal("");
  const receivedOn = useSignal<string>(props.today);
  const method = useSignal<PaymentMethod>("bank");
  const reference = useSignal("");
  const note = useSignal("");
  const emailReceipt = useSignal(true);
  /** What the owner typed per invoice; null until they change one, while it follows the amount oldest first. */
  const typed = useSignal<Readonly<Record<string, string>> | null>(null);
  const problems = useSignal<Problems>({});
  const unreadable = useSignal<Readonly<Record<string, string>>>({});
  const failure = useSignal<string | null>(null);
  const done = useSignal<string | null>(null);
  const busy = useSignal(false);

  const open = props.owed.map(asOpen).filter((i) => i.customerId === customerId.value && balanceOf(i) > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.number.localeCompare(b.number)));
  const read = readKina(amount.value);
  const amountToea = ("toea" in read ? read.toea : Number.NaN) as Toea;
  const proposal = Number.isSafeInteger(amountToea) && amountToea > 0 ? oldestFirst(amountToea, open).allocations : [];
  const applied = (id: string): string => {
    if (typed.value !== null) return typed.value[id] ?? "";
    const a = proposal.find((x) => x.invoiceId === id);
    return a === undefined ? "" : formatKina(a.amountToea);
  };

  /** The allocations as typed; blanks and K0.00 are left out. Unreadable ones are reported by invoice. */
  const allocations = () => {
    const bad: Record<string, string> = {};
    const list = open.flatMap((i) => {
      const text = applied(i.id).trim();
      if (text === "") return [];
      const r = readKina(text);
      if ("problem" in r) {
        bad[i.id] = r.problem;
        return [];
      }
      return r.toea === 0 ? [] : [{ invoiceId: i.id, amountToea: r.toea }];
    });
    return { list, bad };
  };
  const { list } = allocations();
  const credit = Number.isSafeInteger(amountToea) ? creditOf({ amountToea, allocations: list }) : 0;

  const choose = (id: string) => {
    customerId.value = id;
    typed.value = null;
  };
  const type = (id: string, text: string) => {
    typed.value = { ...Object.fromEntries(open.map((i) => [i.id, applied(i.id)])), [id]: text };
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    failure.value = null;
    const { list: allocated, bad } = allocations();
    const payment: PaymentInput = {
      customerId: customerId.value, receivedOn: receivedOn.value as CalendarDate, amountToea, method: method.value,
      reference: reference.value.trim(), note: note.value.trim(), allocations: allocated,
    };
    unreadable.value = bad;
    problems.value = { ...paymentProblems(payment, open, props.today), ...("problem" in read && amount.value.trim() !== "" ? { amountToea: read.problem } : {}) };
    if (Object.keys(problems.value).length > 0 || Object.keys(bad).length > 0) return;
    busy.value = true;
    const outcome = await props.onRecord(props.paymentId, payment, emailReceipt.value);
    busy.value = false;
    if (outcome.ok) done.value = outcome.message;
    else failure.value = outcome.message;
  };

  if (done.value !== null) {
    return (
      <main class="narrow">
        <Back href="/payments" label="Payments" />
        <h1>Payment recorded</h1>
        <p role="status">{done.value}</p>
        <p><a class="button" href="/owed">Back to Still owed</a></p>
        <p><a href="/payments">See all payments</a></p>
      </main>
    );
  }

  const p = problems.value;
  const customers = props.setup.tenants;
  const held = props.credit?.get(customerId.value) ?? 0;
  return (
    <main class="narrow">
      <Back href="/owed" label="Still owed" />
      <h1>Record a payment</h1>
      <form onSubmit={submit} noValidate>
        <Field label="Who paid" problem={p.customerId}>
          <select value={customerId} onChange={(e) => choose(value(e))}>
            <option value="">Choose a customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {held > 0 && <p class="note">They already have {formatKina(held as Toea)} in credit.</p>}
        <Field label="Amount received" hint="Like K1,500.00." problem={p.amountToea}>
          <input inputMode="decimal" value={amount} onInput={(e) => (amount.value = value(e))} />
        </Field>
        <Field label="Received on" problem={p.receivedOn}>
          <input type="date" max={props.today} value={receivedOn} onInput={(e) => (receivedOn.value = value(e))} />
        </Field>
        <Field label="How it was paid" problem={p.method}>
          <select value={method} onChange={(e) => (method.value = value(e) as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </select>
        </Field>
        <Field label="Their reference (optional)" hint="What the bank statement or cheque says." problem={p.reference}>
          <input value={reference} onInput={(e) => (reference.value = value(e))} />
        </Field>

        {customerId.value !== "" && (
          <fieldset class="card">
            <legend>What it pays</legend>
            {open.length === 0 && <p class="note">This customer owes nothing now. The whole amount will be kept as credit.</p>}
            {open.map((i) => (
              <Field key={i.id} label={`Apply to ${i.number}`} hint={`${formatKina(balanceOf(i))} left to pay, due ${dateLabel(i.dueDate)}.`} problem={unreadable.value[i.id]}>
                <input inputMode="decimal" value={applied(i.id)} onInput={(e) => type(i.id, value(e))} />
              </Field>
            ))}
            {typed.value !== null && <button type="button" class="quiet small" onClick={() => (typed.value = null)}>Apply oldest first again</button>}
            {p.allocations !== undefined && <p class="field-problem">{p.allocations}</p>}
            {credit > 0 && <p class="note">{formatKina(credit as Toea)} is more than this pays. It will be kept as credit for them.</p>}
          </fieldset>
        )}

        <Field label="Note for you (optional)" problem={p.note}>
          <input value={note} onInput={(e) => (note.value = value(e))} />
        </Field>
        <label class="check">
          <input type="checkbox" checked={emailReceipt} onChange={(e) => (emailReceipt.value = (e.currentTarget as HTMLInputElement).checked)} />
          Email them a receipt
        </label>
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Record payment</button>
      </form>
    </main>
  );
}
