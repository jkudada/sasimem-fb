/**
 * Billing (PLAN-SUBSCRIBERS §7, S5): renewals due in 30 days, who is overdue, payments this
 * month, and a CSV of payments to set beside the bank statement.
 */
import { useSignal } from "@preact/signals";
import { dateLabel, type Period, periodOf } from "@sasimem/core";
import type { ConsoleData } from "../data.js";
import { kina, STATUS_WORDS } from "../format.js";
import { billingView, paymentsCsv, RENEWAL_WINDOW_DAYS } from "../reports.js";
import { subscriptionToday } from "../rows.js";
import { Field, value } from "./Field.js";
import { LOAD_FAILED, useLoad } from "./useLoad.js";

/** Hand the browser a file to save. */
export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function Billing(props: { data: () => Promise<ConsoleData>; now: () => Date; save?: (filename: string, text: string) => void }) {
  const loaded = useLoad(props.data, async (d) => {
    const [inputs, payments] = await Promise.all([d.subscribers(), d.payments()]);
    return { inputs, payments };
  });
  const thisMonth = periodOf(subscriptionToday(props.now()));
  const from = useSignal<string>(thisMonth);
  const to = useSignal<string>(thisMonth);
  if (loaded.state === "loading") return <main><h1>Billing</h1><p>Loading…</p></main>;
  if (loaded.state === "failed") return <main><h1>Billing</h1><p role="alert">{LOAD_FAILED}</p></main>;
  const b = billingView(loaded.value.inputs, loaded.value.payments, props.now());
  const exportCsv = (e: Event) => {
    e.preventDefault();
    const [a, z] = from.value <= to.value ? [from.value, to.value] : [to.value, from.value];
    (props.save ?? download)(`sasimem-payments-${a}-to-${z}.csv`, paymentsCsv(loaded.value.payments, a as Period, z as Period));
  };

  return (
    <main>
      <h1>Billing</h1>
      <section class="card" aria-label="Renewals due">
        <h2>Renewals due in {RENEWAL_WINDOW_DAYS} days</h2>
        {b.renewals.length === 0 ? <p>None.</p> : (
          <ul>{b.renewals.map((r) => <li key={r.orgId}><a href={`/s/${r.orgId}`}>{r.name}</a>: paid through {dateLabel(r.date)}, {kina(r.amountToea)}, {r.reference ?? "no reference"}</li>)}</ul>
        )}
      </section>
      <section class="card" aria-label="Overdue">
        <h2>Overdue</h2>
        {b.overdue.length === 0 ? <p>None.</p> : (
          <ul>{b.overdue.map((r) => <li key={r.orgId}><a href={`/s/${r.orgId}`}>{r.name}</a>: {STATUS_WORDS[r.status]}, covered until {dateLabel(r.date)}, {kina(r.amountToea)}, {r.reference ?? "no reference"}</li>)}</ul>
        )}
      </section>
      <section class="card" aria-label="Payments this month">
        <h2>Payments this month: {kina(b.receivedThisMonthToea)}</h2>
        {b.paymentsThisMonth.length === 0 ? <p>None yet.</p> : (
          <ul>{b.paymentsThisMonth.map((p) => <li key={`${p.orgId}-${p.id}`}><a href={`/s/${p.orgId}`}>{p.orgName}</a>: {kina(p.amountToea)} on {dateLabel(p.receivedOn)} ({p.bankReference})</li>)}</ul>
        )}
      </section>
      <form class="card" aria-label="Payments CSV" onSubmit={exportCsv}>
        <h2>Payments CSV</h2>
        <p class="note">Every payment received in these months, to check against the bank statement.</p>
        <Field label="From"><input type="month" value={from.value} onInput={(e) => (from.value = value(e))} /></Field>
        <Field label="To"><input type="month" value={to.value} onInput={(e) => (to.value = value(e))} /></Field>
        <button type="submit">Download CSV</button>
      </form>
    </main>
  );
}
