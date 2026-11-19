import { useSignal } from "@preact/signals";
import { type Arrears, type CalendarDate, balanceOf, dateLabel, formatKina, hasPayments, invoiceChip, owedTotal, paidSoFar, periodLabel, type Toea } from "@sasimem/core";
import type { Outcome, OwedInvoice } from "../setup.js";
import { Back } from "./Back.js";

/**
 * Owed (plan §7, screen 6): arrears across months, oldest debt first, grouped by tenant.
 * With payments (G2b): balances, part payments, credit, and Record a payment per customer.
 */
export function Owed(props: {
  groups: readonly Arrears<OwedInvoice>[];
  today: CalendarDate;
  onMarkPaid: (invoiceId: string, note: string) => Promise<Outcome>;
  /** True when the org records payments (G2b, behind `oneOff`). */
  payments?: boolean;
  /** Unused credit per customer. */
  credit?: ReadonlyMap<string, number>;
}) {
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
          {(props.credit?.get(g.tenantId) ?? 0) > 0 && <p class="note">{formatKina(props.credit?.get(g.tenantId) as Toea)} in credit</p>}
          {props.payments === true && <a class="button" href={`/payments/new?customer=${encodeURIComponent(g.tenantId)}`} aria-label={`Record a payment from ${g.tenantName}`}>Record a payment</a>}
          <ul class="invoices">
            {g.invoices.map((i) => (
              <li key={i.id} class="card">
                <p><strong>{i.number} · {periodLabel(i.period)}</strong> · {formatKina(i.totalToea)}</p>
                {hasPayments(i) && <p class="note">{formatKina(paidSoFar(i))} paid · {formatKina(balanceOf(i))} left</p>}
                <p class="note">due {dateLabel(i.dueDate)} · {invoiceChip(i, props.today)}</p>
                {/* Part paid: the rest is recorded as a payment, so the receipt and balance stay right. */}
                {!hasPayments(i) && <button type="button" class={props.payments === true ? "quiet" : ""} aria-label={`Mark ${i.number ?? ""} paid`} disabled={busy} onClick={() => void tick(i.id)}>Mark paid</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p class="note">Oldest debt first. Ticking paid emails nobody.</p>
    </main>
  );
}
