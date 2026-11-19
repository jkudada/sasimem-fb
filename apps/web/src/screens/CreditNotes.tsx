/**
 * Credit notes issued (G2c): each with the invoice it credits and where the money went.
 * A credit note is a tax document: it is never edited or undone.
 */
import { useSignal } from "@preact/signals";
import { dateLabel, formatKina } from "@sasimem/core";
import type { CreditNoteRow, Outcome } from "../setup.js";
import { Back } from "./Back.js";

export function CreditNotes(props: {
  creditNotes: readonly CreditNoteRow[];
  onOpenPdf: (id: string) => Promise<Outcome>;
  onResend: (id: string) => Promise<Outcome>;
}) {
  const message = useSignal<Outcome | null>(null);
  const busy = useSignal(false);
  const act = async (run: () => Promise<Outcome>) => {
    busy.value = true;
    const o = await run();
    message.value = o.message === "" ? null : o;
    busy.value = false;
  };
  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Credit notes</h1>
      <p class="note">To credit an invoice, open it from One-off invoices, Still owed or the month it was sent, and choose Credit note.</p>
      {message.value !== null && <p role={message.value.ok ? "status" : "alert"}>{message.value.message}</p>}
      {props.creditNotes.length === 0 && <p>No credit notes yet.</p>}
      <ul class="invoices">
        {props.creditNotes.map((c) => (
          <li key={c.id} class="card">
            <p><strong>{c.number} · {c.customerName}</strong> · {formatKina(c.totalToea)}</p>
            <p class="note">
              for {c.invoiceNumber} · {dateLabel(c.issueDate)} · {c.reason}
              {c.appliedToea > 0 && ` · ${formatKina(c.appliedToea)} off the invoice`}
              {c.creditToea > 0 && ` · ${formatKina(c.creditToea)} kept as credit`}
            </p>
            <div>
              <button type="button" class="quiet small" aria-label={`Open the PDF of ${c.number}`} disabled={busy} onClick={() => void act(() => props.onOpenPdf(c.id))}>Open PDF</button>
              <button type="button" class="quiet small" aria-label={`Email ${c.number} again`} disabled={busy} onClick={() => void act(() => props.onResend(c.id))}>Email again</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
