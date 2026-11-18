/**
 * The operator's actions on one subscription (PLAN-SUBSCRIBERS §7, S3), each a small
 * form sending one of core's OperatorActions through the audited `operatorAction`
 * callable. The server decides; a refusal shows its words, success reloads the page.
 */
import { useSignal } from "@preact/signals";
import {
  type CalendarDate, type Interval, localDate, parseKina, type PlanId, SUBSCRIPTION_TIMEZONE, type SubscriptionFields, type SubscriptionStatus,
} from "@sasimem/core";
import type { JSX } from "preact";
import { Field, value } from "./Field.js";

type Operate = (action: unknown) => Promise<string | null>;

/** One form: its fields, a submit button, and its own problem line. */
function ActionForm(props: { title: string; button: string; operate: Operate; action: () => unknown | { problem: string }; onDone: () => void; children?: JSX.Element | JSX.Element[] | false }) {
  const busy = useSignal(false);
  const problem = useSignal<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    const action = props.action();
    if (typeof action === "object" && action !== null && "problem" in action) {
      problem.value = (action as { problem: string }).problem;
      return;
    }
    busy.value = true;
    problem.value = await props.operate(action);
    busy.value = false;
    if (problem.value === null) props.onDone();
  };
  return (
    <form class="card" aria-label={props.title} onSubmit={submit}>
      <h3>{props.title}</h3>
      {props.children}
      {problem.value !== null && <p role="alert" class="problem">{problem.value}</p>}
      <button type="submit" disabled={busy.value}>{busy.value ? "Saving…" : props.button}</button>
    </form>
  );
}

const whole = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

export function SubscriberActions(props: { sub: SubscriptionFields; status: SubscriptionStatus; operate: Operate; onDone: () => void; now: () => Date }) {
  const { sub, status, onDone } = props;
  const operate = props.operate;
  const today = localDate(props.now(), SUBSCRIPTION_TIMEZONE);
  const amount = useSignal(String(sub.priceToea / 100));
  const receivedOn = useSignal<string>(today);
  const bankReference = useSignal("");
  const months = useSignal(sub.interval === "annual" ? "12" : "3");
  const planId = useSignal<PlanId>(sub.planId);
  const interval = useSignal<Interval>(sub.interval);
  const days = useSignal("14");
  const limit = useSignal(sub.limitOverride === null ? "" : String(sub.limitOverride));
  const note = useSignal("");
  const confirmingCancel = useSignal(false);

  const free = sub.planId === "free";
  const cancelled = status === "cancelled";
  const payment = () => {
    let toea: number;
    try {
      toea = parseKina(amount.value);
    } catch {
      return { problem: "Enter the amount in kina, like 400.00." };
    }
    return { kind: "recordPayment", amountToea: toea, receivedOn: receivedOn.value as CalendarDate, bankReference: bankReference.value, months: whole(months.value) };
  };

  if (cancelled) {
    return (
      <section aria-label="Actions">
        <h2>Actions</h2>
        <ActionForm title="Reinstate" button="Reinstate" operate={operate} onDone={onDone} action={() => ({ kind: "reinstate" })}>
          <p>Cancelled{sub.purgeAfter === null ? "" : `; purged from ${sub.purgeAfter}`}. Reinstating gives back the status its plan and dates say.</p>
        </ActionForm>
        <NoteForm note={note} operate={operate} onDone={onDone} />
      </section>
    );
  }

  return (
    <section aria-label="Actions">
      <h2>Actions</h2>
      {!free && (
        <ActionForm title="Record a payment" button="Record payment" operate={operate} onDone={onDone} action={payment}>
          <Field label="Amount (kina)"><input inputMode="decimal" value={amount.value} onInput={(e) => (amount.value = value(e))} /></Field>
          <Field label="Arrived on"><input type="date" max={today} value={receivedOn.value} onInput={(e) => (receivedOn.value = value(e))} /></Field>
          <Field label="Bank reference" hint={`The subscriber's reference should be ${sub.paymentReference ?? "their SUB- number"}.`}>
            <input value={bankReference.value} onInput={(e) => (bankReference.value = value(e))} />
          </Field>
          <Field label="Months it pays for"><input inputMode="numeric" value={months.value} onInput={(e) => (months.value = value(e))} /></Field>
        </ActionForm>
      )}

      <ActionForm title="Change plan" button="Change plan" operate={operate} onDone={onDone} action={() => ({ kind: "changePlan", planId: planId.value, interval: interval.value })}>
        <Field label="Plan">
          <select value={planId.value} onChange={(e) => (planId.value = value(e) as PlanId)}>
            <option value="free">Free</option><option value="standard">Standard</option><option value="plus">Plus</option>
          </select>
        </Field>
        <Field label="Billing">
          <select value={interval.value} onChange={(e) => (interval.value = value(e) as Interval)}>
            <option value="annual">Annual</option><option value="monthly">Monthly</option>
          </select>
        </Field>
      </ActionForm>

      {!free && (
        <ActionForm title="Extend the trial" button="Extend trial" operate={operate} onDone={onDone} action={() => ({ kind: "extendTrial", days: whole(days.value) })}>
          <Field label="Days to add"><input inputMode="numeric" value={days.value} onInput={(e) => (days.value = value(e))} /></Field>
        </ActionForm>
      )}

      <ActionForm title="Tenancy limit" button="Set limit" operate={operate} onDone={onDone}
        action={() => ({ kind: "setLimitOverride", limit: limit.value.trim() === "" ? null : whole(limit.value) })}>
        <Field label="Limit" hint="Blank for the plan's own limit."><input inputMode="numeric" value={limit.value} onInput={(e) => (limit.value = value(e))} /></Field>
      </ActionForm>

      {sub.manuallyRestricted === true
        ? <ActionForm title="Restricted by hand" button="Lift the restriction" operate={operate} onDone={onDone} action={() => ({ kind: "unrestrict" })} />
        : (
          <ActionForm title="Restrict by hand" button="Restrict" operate={operate} onDone={onDone} action={() => ({ kind: "restrict" })}>
            <p>No new month is drafted until lifted. Runs already drafted carry on.</p>
          </ActionForm>
        )}

      <NoteForm note={note} operate={operate} onDone={onDone} />

      {confirmingCancel.value
        ? (
          <ActionForm title="Cancel the subscription?" button="Yes, cancel" operate={operate} onDone={onDone} action={() => ({ kind: "cancelSubscription" })}>
            <p>No new month is drafted. The organisation is kept read-only for 90 days, then purged. It can be reinstated until then.</p>
            <button type="button" class="quiet" onClick={() => (confirmingCancel.value = false)}>Keep it</button>
          </ActionForm>
        )
        : <button type="button" class="danger small" onClick={() => (confirmingCancel.value = true)}>Cancel the subscription…</button>}
    </section>
  );
}

function NoteForm(props: { note: { value: string }; operate: Operate; onDone: () => void }) {
  const { note } = props;
  return (
    <ActionForm title="Add a note" button="Add note" operate={props.operate} onDone={() => { note.value = ""; props.onDone(); }}
      action={() => ({ kind: "addNote", text: note.value })}>
      <Field label="Note"><textarea rows={3} value={note.value} onInput={(e) => (note.value = (e.currentTarget as HTMLTextAreaElement).value)} /></Field>
    </ActionForm>
  );
}
