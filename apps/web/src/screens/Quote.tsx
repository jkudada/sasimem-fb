/**
 * One sent quote (docs/PLAN-GENERAL-INVOICING.md §3.3, G2q-b): where it stands, who
 * answered and when, and the owner's two actions - record an answer the customer gave by
 * phone or on paper, and undo an acceptance (a forwarded link) until it is invoiced.
 */
import { useSignal } from "@preact/signals";
import { QUOTE_STATUS_LABELS, dateLabel, formatKina, quoteAllows } from "@sasimem/core";
import type { Outcome, QuoteAnswerForm, QuoteDetail } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { sendLabel } from "./when.js";

export function Quote(props: {
  quote: QuoteDetail;
  timezone: string;
  now: Date;
  onMark: (id: string, answer: QuoteAnswerForm) => Promise<Outcome>;
  onUndo: (id: string) => Promise<Outcome>;
  /** Load the quote again after a change. */
  onChanged: () => void;
}) {
  const q = props.quote;
  const when = (at: Date) => sendLabel(at, props.timezone);
  const allows = quoteAllows(q, props.now, props.timezone);
  const recording = useSignal(false);
  const answer = useSignal<"accept" | "decline">("accept");
  const name = useSignal("");
  const poNumber = useSignal("");
  const reason = useSignal("");
  const busy = useSignal(false);
  const said = useSignal<Outcome | null>(null);

  const act = async (run: () => Promise<Outcome>) => {
    busy.value = true;
    said.value = await run();
    busy.value = false;
    if (said.value.ok) {
      recording.value = false;
      props.onChanged();
    }
  };
  const record = (e: Event) => {
    e.preventDefault();
    void act(() => props.onMark(q.id, { answer: answer.value, name: name.value, poNumber: poNumber.value, reason: reason.value }));
  };

  const a = q.acceptance;
  const d = q.decline;
  return (
    <main class="narrow">
      <Back href="/quotes" label="Quotes" />
      <h1>{q.label}</h1>
      <p class="lede">{q.customerName} · {formatKina(q.totalToea)} · valid until {dateLabel(q.validUntil)}</p>
      <p><strong>{QUOTE_STATUS_LABELS[q.status]}</strong>{q.viewedAt !== null && ` · first opened at ${when(q.viewedAt)}`}</p>

      {a !== null && (
        <p>
          Accepted by {a.name} at {when(a.at)}{a.by === "owner" ? ", recorded by you" : ", on the quote's link"}.
          {a.poNumber !== "" && <> Order number {a.poNumber}.</>}
        </p>
      )}
      {d !== null && (
        <p>
          Declined at {when(d.at)}{d.by === "owner" ? ", recorded by you" : ", on the quote's link"}.
          {d.reason !== "" && <> Reason: {d.reason}</>}
        </p>
      )}

      {said.value !== null && <p role={said.value.ok ? "status" : "alert"}>{said.value.message}</p>}

      {allows.answer && !recording.value && (
        <>
          <p class="note">If your customer answered by phone or on paper, record it here. They are not emailed.</p>
          <button type="button" class="quiet" onClick={() => (recording.value = true)}>Record an answer</button>
        </>
      )}
      {allows.answer && recording.value && (
        <form onSubmit={record} noValidate>
          <fieldset>
            <legend>Their answer</legend>
            <label class="check"><input type="radio" name="answer" checked={answer.value === "accept"} onChange={() => (answer.value = "accept")} /> Accepted</label>
            <label class="check"><input type="radio" name="answer" checked={answer.value === "decline"} onChange={() => (answer.value = "decline")} /> Declined</label>
          </fieldset>
          {answer.value === "accept" ? (
            <>
              <Field label="Who accepted"><input value={name} autocomplete="off" onInput={(e) => (name.value = value(e))} /></Field>
              <Field label="Their order number (optional)"><input value={poNumber} onInput={(e) => (poNumber.value = value(e))} /></Field>
            </>
          ) : (
            <Field label="Their reason (optional)"><textarea rows={3} value={reason} onInput={(e) => (reason.value = value(e))} /></Field>
          )}
          <button type="submit" disabled={busy}>Record</button>
          <button type="button" class="quiet" disabled={busy} onClick={() => (recording.value = false)}>Cancel</button>
        </form>
      )}

      {allows.undo && (
        <>
          <p class="note">If it was not your customer who accepted (a forwarded email, say), undo it. The quote is open again on its link.</p>
          <button type="button" class="danger" disabled={busy} onClick={() => void act(() => props.onUndo(q.id))}>Undo the acceptance</button>
        </>
      )}
    </main>
  );
}
