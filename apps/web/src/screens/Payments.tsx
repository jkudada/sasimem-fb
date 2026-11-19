/**
 * Payments received (G2b): each with its receipt number and where it went. A mistaken
 * one is undone with a reason, never edited; its receipt number stays used.
 */
import { useSignal } from "@preact/signals";
import { METHOD_LABELS, type Toea, dateLabel, formatKina, undoReasonProblem } from "@sasimem/core";
import type { Outcome, PaymentRow } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";

export function Payments(props: {
  payments: readonly PaymentRow[];
  onUndo: (paymentId: string, reason: string) => Promise<Outcome>;
  onResend: (paymentId: string) => Promise<Outcome>;
}) {
  const message = useSignal<Outcome | null>(null);
  const undoing = useSignal<string | null>(null);
  const reason = useSignal("");
  const problem = useSignal<string | null>(null);
  const busy = useSignal(false);

  const act = async (run: () => Promise<Outcome>) => {
    busy.value = true;
    message.value = await run();
    busy.value = false;
  };
  const undo = async (e: Event, id: string) => {
    e.preventDefault();
    problem.value = undoReasonProblem(reason.value);
    if (problem.value !== null) return;
    await act(() => props.onUndo(id, reason.value.trim()));
    if (message.value?.ok === true) undoing.value = null;
  };

  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Payments</h1>
      <a class="button" href="/payments/new">Record a payment</a>
      {message.value !== null && <p role={message.value.ok ? "status" : "alert"}>{message.value.message}</p>}
      {props.payments.length === 0 && <p>No payments recorded yet.</p>}
      <ul class="invoices">
        {props.payments.map((p) => {
          // A payment of credit only (G2c) has no receipt: it is named by its date and the credit used.
          const name = p.receiptNumber !== "" ? p.receiptNumber : `the credit used ${dateLabel(p.receivedOn)}`;
          return (
          <li key={p.id} class="card">
            <p><strong>{p.receiptNumber !== "" ? p.receiptNumber : "Credit used"} · {p.customerName}</strong> · {formatKina(p.receiptNumber !== "" ? p.amountToea : (p.creditUsedToea ?? p.amountToea))}</p>
            <p class="note">
              {dateLabel(p.receivedOn)}{p.receiptNumber !== "" && ` · ${METHOD_LABELS[p.method]}`}{p.reference !== "" && ` · ${p.reference}`}
              {p.receiptNumber !== "" && (p.creditUsedToea ?? 0) > 0 && ` · and ${formatKina(p.creditUsedToea as Toea)} of credit`}
              {p.allocations.length > 0 && ` · paid ${p.allocations.map((a) => `${a.number} ${formatKina(a.amountToea)}`).join(", ")}`}
              {p.creditToea > 0 && ` · ${formatKina(p.creditToea as Toea)} credit`}
            </p>
            {p.status === "undone" ? <p class="note"><span class="chip">Undone</span> {p.undoReason}</p> : undoing.value === p.id ? (
              <form onSubmit={(e) => void undo(e, p.id)} noValidate>
                <Field label={`Why undo ${name}?`} hint="Its invoices go back to owing what they did before it. Nobody is emailed." problem={problem.value ?? undefined}>
                  <input value={reason} onInput={(e) => (reason.value = value(e))} />
                </Field>
                <button type="submit" class="danger" disabled={busy}>Undo this payment</button>
                <button type="button" class="quiet" onClick={() => (undoing.value = null)}>Keep it</button>
              </form>
            ) : (
              <div>
                {p.receiptNumber !== "" && <button type="button" class="quiet small" aria-label={`Email ${p.receiptNumber} again`} disabled={busy} onClick={() => void act(() => props.onResend(p.id))}>Email receipt again</button>}
                <button type="button" class="quiet small" aria-label={`Undo ${name}`} disabled={busy} onClick={() => { undoing.value = p.id; reason.value = ""; problem.value = null; }}>Undo…</button>
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </main>
  );
}
