/** Metrics (PLAN-SUBSCRIBERS §7, S5): subscribers by plan and status, revenue, conversion, churn and invoices sent. */
import { defaultPlan, type PlanId, type SubscriptionStatus } from "@sasimem/core";
import type { ConsoleData } from "../data.js";
import { kina, STATUS_WORDS } from "../format.js";
import { metricsView } from "../reports.js";
import { LOAD_FAILED, useLoad } from "./useLoad.js";

const PLANS: readonly PlanId[] = ["free", "standard", "plus"];
const STATUSES: readonly SubscriptionStatus[] = ["trial", "free", "active", "past_due", "restricted", "cancelled"];

export function Metrics(props: { data: () => Promise<ConsoleData>; now: () => Date }) {
  const loaded = useLoad(props.data, (d) => d.subscribers());
  if (loaded.state === "loading") return <main><h1>Metrics</h1><p>Loading…</p></main>;
  if (loaded.state === "failed") return <main><h1>Metrics</h1><p role="alert">{LOAD_FAILED}</p></main>;
  const m = metricsView(loaded.value, props.now());
  const rate = m.trials.ended === 0 ? "none ended yet" : `${Math.round((100 * m.trials.paid) / m.trials.ended)}% (${m.trials.paid} of ${m.trials.ended})`;

  return (
    <main>
      <h1>Metrics</h1>
      <section class="card" aria-label="Revenue">
        <h2>Annual recurring revenue</h2>
        <p class="big">{kina(m.annualRevenueToea)}</p>
        <p class="note">Active and past-due subscriptions at their locked price, a year's worth. Trials and free count nothing.</p>
        <p>Trials that became paid: {rate}</p>
      </section>
      <section class="card" aria-label="Subscribers by plan">
        <h2>Subscribers by plan and status</h2>
        <div class="scroll"><table>
          <thead><tr><th>Plan</th>{STATUSES.map((s) => <th key={s}>{STATUS_WORDS[s]}</th>)}</tr></thead>
          <tbody>{PLANS.map((p) => (
            <tr key={p}><td>{defaultPlan(p).name}</td>{STATUSES.map((s) => <td key={s}>{m.byPlan[p][s] ?? 0}</td>)}</tr>
          ))}</tbody>
        </table></div>
      </section>
      <section class="card" aria-label="By month">
        <h2>By month</h2>
        <div class="scroll"><table>
          <thead><tr><th>Month</th><th>Cancelled</th><th>Invoices sent</th></tr></thead>
          <tbody>{[...m.months].reverse().map((x) => <tr key={x.period}><td>{x.period}</td><td>{x.cancelled}</td><td>{x.invoicesSent}</td></tr>)}</tbody>
        </table></div>
      </section>
    </main>
  );
}
