/**
 * Quotes (docs/PLAN-GENERAL-INVOICING.md §3.3, G2q-a): drafts being written, and the
 * quotes sent, with how long each holds and where it stands.
 */
import { QUOTE_STATUS_LABELS, dateLabel, formatKina, itemLine, totals } from "@sasimem/core";
import type { Quotes as List, Setup } from "../setup.js";
import { Back } from "./Back.js";

export function Quotes(props: { list: List; setup: Setup }) {
  const { drafts, sent } = props.list;
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
      <h1>Quotes</h1>
      <p class="lede">A price for the work, before you do it. It is numbered and emailed with a link to accept it when you press Send.</p>
      <a class="button" href="/quotes/new">New quote</a>

      {drafts.length > 0 && (
        <>
          <h2 class="section-title">Drafts</h2>
          <ul class="links">
            {drafts.map((d) => (
              <li key={d.id}>
                <a href={`/quotes/${d.id}`}>{nameOf(d.customerId)}</a>
                <span class="note">Draft · {d.lines.length} {d.lines.length === 1 ? "line" : "lines"} {totalOf([...d.lines])}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 class="section-title">Sent</h2>
      {sent.length === 0 && <p>Nothing sent yet.</p>}
      <ul class="links">
        {sent.map((q) => (
          <li key={q.id}>
            <strong>{q.label} · {q.customerName}</strong>
            <span class="note">{formatKina(q.totalToea)} · valid until {dateLabel(q.validUntil)} · {QUOTE_STATUS_LABELS[q.status]}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
