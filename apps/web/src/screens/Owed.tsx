import { useSignal } from "@preact/signals";
import { type Arrears, type CalendarDate, dateLabel, formatKina, invoiceChip, owedTotal, periodLabel, type Toea } from "@sasimem/core";
import type { Outcome, OwedInvoice } from "../setup.js";
import { Back } from "./Back.js";

/** Owed (plan §7, screen 6): arrears across months, oldest debt first, grouped by tenant. */
export function Owed(props: { groups: readonly Arrears<OwedInvoice>[]; today: CalendarDate; onMarkPaid: (invoiceId: string, note: string) => Promise<Outcome> }) {
  const busy = useSignal(false);
  const message = useSignal<Outcome | null>(null);
  const tick = async (id: string) => {
    busy.value = true;
    message.value = await props.onMarkPaid(id, "");
    busy.value = false;
  };
  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Still owed</h1>
      <p class="total">{props.groups.length === 0 ? "Nothing owed. Every invoice sent has been paid." : `${formatKina(owedTotal(props.groups) as Toea)} owed`}</p>
      {message.value !== null && message.value.message !== "" && <p role={message.value.ok ? "status" : "alert"}>{message.value.message}</p>}
      {props.groups.map((g) => (
        <section key={g.tenantId}>
          <h2>{g.tenantName} · {formatKina(g.totalToea as Toea)}</h2>
          <ul class="invoices">
            {g.invoices.map((i) => (
              <li key={i.id} class="card">
                <p><strong>{i.number} · {periodLabel(i.period)}</strong> · {formatKina(i.totalToea)}</p>
                <p class="note">due {dateLabel(i.dueDate)} · {invoiceChip(i, props.today)}</p>
                <button type="button" aria-label={`Mark ${i.number ?? ""} paid`} disabled={busy} onClick={() => void tick(i.id)}>Mark paid</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p class="note">Oldest debt first. Ticking paid emails nobody.</p>
    </main>
  );
}
