/**
 * One-off invoices (docs/PLAN-GENERAL-INVOICING.md G2a): drafts being written, and the
 * invoices sent. Payments are recorded from Still owed, as for rent.
 */
import { useSignal } from "@preact/signals";
import { type CalendarDate, balanceOf, dateLabel, formatKina, hasCreditNotes, hasPayments, invoiceChip, itemLine, sendLaterLabel, totals } from "@sasimem/core";
import type { OneOffs as List, Outcome, Setup } from "../setup.js";
import { Back } from "./Back.js";

export function OneOffs(props: { list: List; setup: Setup; today: CalendarDate; onOpenPdf: (invoiceId: string) => Promise<Outcome> }) {
  const { drafts, invoices } = props.list;
  const failure = useSignal<string | null>(null);
  const nameOf = (customerId: string) => props.setup.tenants.find((t) => t.id === customerId)?.name ?? "No customer yet";
  const totalOf = (lines: Parameters<typeof itemLine>[0][]) => {
    try {
      return formatKina(totals(lines.map((l) => itemLine(l, props.setup.org))).totalToea);
    } catch {
      return ""; // a draft line that is not finished yet
    }
  };

  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>One-off invoices</h1>
      <p class="lede">An invoice for a job or a sale. It is numbered and emailed with its PDF when you press Send.</p>
      <a class="button" href="/one-off/new">New invoice</a>

      {drafts.length > 0 && (
        <>
          <h2 class="section-title">Drafts</h2>
          <ul class="links">
            {drafts.map((d) => (
              <li key={d.id}>
                <a href={`/one-off/${d.id}`}>{nameOf(d.customerId)}</a>
                <span class="note">
                  Draft · {d.lines.length} {d.lines.length === 1 ? "line" : "lines"} {totalOf([...d.lines])}
                  {d.sendLater !== undefined && (d.sendLater.problem === undefined
                    ? ` · Goes on ${sendLaterLabel(d.sendLater.sendOn, props.setup.org.sendHour)}`
                    : ` · Not sent on ${dateLabel(d.sendLater.sendOn)}: ${d.sendLater.problem}`)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 class="section-title">Sent</h2>
      {invoices.length === 0 && <p>Nothing sent yet.</p>}
      {failure.value !== null && <p role="alert">{failure.value}</p>}
      <ul class="links">
        {invoices.map((i) => (
          <li key={i.id}>
            <strong>{i.number} · {i.customerName}</strong>
            <span class="note">
              {formatKina(i.totalToea)}{hasCreditNotes(i) && ` · ${formatKina(i.creditNotedToea ?? i.totalToea)} credited`}
              {(hasPayments(i) || hasCreditNotes(i)) && i.status === "sent" && ` · ${formatKina(balanceOf(i))} left`} · due {dateLabel(i.dueDate)} · {invoiceChip(i, props.today)}
            </span>
            <button type="button" class="quiet small" aria-label={`Open the PDF of ${i.number}`} onClick={async () => {
              const o = await props.onOpenPdf(i.id);
              failure.value = o.ok ? null : o.message;
            }}>Open PDF</button>
            {(i.status === "sent" || i.status === "paid") && (i.creditNotedToea ?? 0) < i.totalToea && (
              <a class="quiet small" href={`/credit-notes/new?invoice=${encodeURIComponent(i.id)}`} aria-label={`Credit note for ${i.number}`}>Credit note</a>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
