/**
 * One sent quote (docs/PLAN-GENERAL-INVOICING.md §3.3, G2q-b and G2q-c): where it stands,
 * who answered and when, and the owner's actions - record an answer the customer gave by
 * phone or on paper, undo an acceptance (a forwarded link) until it is invoiced, revise it,
 * and turn it into invoices: in full or a deposit, then the rest.
 */
import { useSignal } from "@preact/signals";
import { QUOTE_STATUS_LABELS, type QuoteInvoiceKind, type Toea, dateLabel, formatKina, quoteAllows, quoteInvoiceId, quoteInvoiced, quoteLabel } from "@sasimem/core";
import type { Outcome, QuoteAnswerForm, QuoteDetail } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { sendLabel } from "./when.js";

const DRAFT_LABELS: Readonly<Record<QuoteInvoiceKind, string>> = { full: "The invoice", deposit: "The deposit invoice", final: "The final invoice" };
const INVOICE_KINDS: Readonly<Record<QuoteInvoiceKind, string>> = { full: "", deposit: " (deposit)", final: " (final)" };

export function Quote(props: {
  quote: QuoteDetail;
  timezone: string;
  now: Date;
  onMark: (id: string, answer: QuoteAnswerForm) => Promise<Outcome>;
  onUndo: (id: string) => Promise<Outcome>;
  onDraftFrom: (id: string, kind: QuoteInvoiceKind) => Promise<Outcome>;
  /** Open the revision draft: its id, or a problem. */
  onRevise: (id: string) => Promise<{ readonly id: string } | { readonly problem: string }>;
  /** Go to a page in the app (the revision draft). */
  onOpen: (href: string) => void;
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
  const revise = async () => {
    busy.value = true;
    const opened = await props.onRevise(q.id);
    busy.value = false;
    if ("problem" in opened) said.value = { ok: false, message: opened.problem };
    else props.onOpen(`/quotes/${opened.id}`);
  };

  const a = q.acceptance;
  const d = q.decline;
  const sentKinds = q.invoices.map((i) => i.kind);
  const nothingSent = q.invoices.length === 0;
  const canFinal = sentKinds.includes("deposit") && !sentKinds.includes("final") && !q.drafts.includes("final");
  return (
    <main class="narrow">
      <Back href="/quotes" label="Quotes" />
      <h1>{q.label}</h1>
      <p class="lede">{q.customerName} · {formatKina(q.totalToea)} · valid until {dateLabel(q.validUntil)}</p>
      <p><strong>{QUOTE_STATUS_LABELS[q.status]}</strong>{q.viewedAt !== null && ` · first opened at ${when(q.viewedAt)}`}</p>
      {q.revisions.length > 0 && (
        <p class="note">
          Replaces {q.revisions.map((r) => `${quoteLabel(q.number, r.revision)} of ${dateLabel(r.issueDate)} (${formatKina(r.totalToea)}, ${QUOTE_STATUS_LABELS[r.status].toLowerCase()})`).join("; ")}.
        </p>
      )}

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

      {a !== null && (
        <section aria-labelledby="invoicing">
          <h2 id="invoicing">Invoicing</h2>
          <p>{invoicedLine(q.invoicedToea, a.totalToea)}</p>
          {q.invoices.length > 0 && (
            <ul>
              {q.invoices.map((i) => <li key={i.id}>{i.number}{INVOICE_KINDS[i.kind]} · {formatKina(i.totalToea)}</li>)}
            </ul>
          )}
          {q.drafts.map((k) => (
            <p key={k}><a href={`/one-off/${quoteInvoiceId(q.id, q.revision, k)}`}>{DRAFT_LABELS[k]}</a> is drafted for you to check and send.</p>
          ))}
          {nothingSent && (
            q.drafts.includes("deposit")
              ? <button type="button" class="quiet" disabled={busy} onClick={() => void act(() => props.onDraftFrom(q.id, "full"))}>Invoice in full instead</button>
              : q.drafts.includes("full")
                ? <button type="button" class="quiet" disabled={busy} onClick={() => void act(() => props.onDraftFrom(q.id, "deposit"))}>Ask for a deposit instead</button>
                : <button type="button" disabled={busy} onClick={() => void act(() => props.onDraftFrom(q.id, "full"))}>Draft the invoice</button>
          )}
          {canFinal && <button type="button" disabled={busy} onClick={() => void act(() => props.onDraftFrom(q.id, "final"))}>Invoice the rest</button>}
        </section>
      )}

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

      {allows.revise && (
        <>
          <p class="note">Change it and send it again as revision {q.revision + 1}. The link you sent before stops working.</p>
          <button type="button" class="quiet" disabled={busy} onClick={() => void revise()}>Revise</button>
        </>
      )}

      {allows.undo && (
        <>
          <p class="note">If it was not your customer who accepted (a forwarded email, say), undo it. The quote is open again on its link, and its unsent invoice draft goes.</p>
          <button type="button" class="danger" disabled={busy} onClick={() => void act(() => props.onUndo(q.id))}>Undo the acceptance</button>
        </>
      )}
    </main>
  );
}

function invoicedLine(invoicedToea: Toea, acceptedToea: Toea): string {
  const { invoiced, overToea } = quoteInvoiced({ acceptance: { totalToea: acceptedToea }, invoicedToea });
  if (invoicedToea === 0) return "Nothing invoiced yet.";
  if (overToea > 0) return `Invoiced ${formatKina(invoicedToea)}: ${formatKina(overToea as Toea)} more than the accepted quote.`;
  if (invoiced) return "Invoiced in full.";
  return `Invoiced ${formatKina(invoicedToea)} of ${formatKina(acceptedToea)}.`;
}
