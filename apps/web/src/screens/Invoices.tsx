import { useSignal } from "@preact/signals";
import { type Period, type RunStatus, exportRangeProblem, formatKina, parsePeriod, periodLabel } from "@sasimem/core";
import type { MonthSummary, Outcome } from "../setup.js";
import { Back } from "./Back.js";

/** A run's status in the landlord's words, never the system's (plan §7). */
export const RUN_WORDS: Record<RunStatus, string> = {
  draft: "Drafted", awaitingApproval: "Waiting for you", held: "Held - not sent", approved: "Approved", sent: "Sent", cancelled: "Cancelled",
};

/** Invoices (plan §7, screen 5): every month, and the CSV export (PLAN.md rec. 7). */
export function Invoices(props: { months: readonly MonthSummary[]; thisMonth: Period; onExport: (from: Period, to: Period) => Promise<Outcome> }) {
  const from = useSignal(`${props.thisMonth.slice(0, 4)}-01`);
  const to = useSignal<string>(props.thisMonth);
  const problem = useSignal<string | null>(null);
  const busy = useSignal(false);

  const download = async () => {
    let range: [Period, Period];
    try {
      range = [parsePeriod(from.value), parsePeriod(to.value)];
    } catch {
      problem.value = "Choose a month for each end.";
      return;
    }
    problem.value = exportRangeProblem(...range);
    if (problem.value !== null) return;
    busy.value = true;
    const outcome = await props.onExport(...range);
    busy.value = false;
    problem.value = outcome.ok ? null : outcome.message;
  };

  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Invoices</h1>
      {props.months.length === 0 ? <p>No invoices yet.</p> : (
        <ul class="links">
          {props.months.map((m) => (
            <li key={m.period}>
              <a href={`/month/${m.period}`}>{periodLabel(m.period)} · {RUN_WORDS[m.status]}</a>
              <span class="note">{m.invoiceCount} {m.invoiceCount === 1 ? "invoice" : "invoices"}, {formatKina(m.totalToea)}</span>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="export" class="card">
        <h2 id="export">Export for your accountant</h2>
        <p class="note">Every numbered invoice in the months you choose, as a CSV file a spreadsheet opens.</p>
        <div class="row">
          <label class="field"><span class="field-label">From</span><input type="month" value={from} onInput={(e) => (from.value = (e.currentTarget as HTMLInputElement).value)} /></label>
          <label class="field"><span class="field-label">To</span><input type="month" value={to} onInput={(e) => (to.value = (e.currentTarget as HTMLInputElement).value)} /></label>
        </div>
        {problem.value !== null && <p class="field-problem" role="alert">{problem.value}</p>}
        <button type="button" disabled={busy} onClick={() => void download()}>Download CSV</button>
      </section>
    </main>
  );
}
