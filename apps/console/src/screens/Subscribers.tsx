import { useSignal } from "@preact/signals";
import type { ConsoleData } from "../data.js";
import { day, STATUS_WORDS, when } from "../format.js";
import { FILTERS, type Filter, filterRows, subscriberRows } from "../rows.js";
import { LOAD_FAILED, useLoad } from "./useLoad.js";

export function Subscribers(props: { data: () => Promise<ConsoleData>; now: () => Date }) {
  const loaded = useLoad(props.data, (d) => d.subscribers());
  const filter = useSignal<Filter>("all");
  if (loaded.state === "loading") return <main><h1>Subscribers</h1><p>Loading…</p></main>;
  if (loaded.state === "failed") return <main><h1>Subscribers</h1><p role="alert">{LOAD_FAILED}</p></main>;

  const all = subscriberRows(loaded.value, props.now());
  const rows = filterRows(all, filter.value);
  return (
    <main>
      <h1>Subscribers</h1>
      <div class="filters" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button type="button" class="small" aria-pressed={filter.value === f.key} onClick={() => (filter.value = f.key)}>
            {f.label} ({filterRows(all, f.key).length})
          </button>
        ))}
      </div>
      {rows.length === 0 ? <p>None.</p> : (
        <div class="scroll">
          <table>
            <thead><tr><th>Organisation</th><th>Plan</th><th>Status</th><th>Tenancies</th><th>Date</th><th>Reference</th><th>Last approval</th><th>Needs a look</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.orgId}>
                  <td><a href={`/s/${r.orgId}`}>{r.name}</a><br /><span class="note">{r.email}</span></td>
                  <td>{r.plan}</td>
                  <td class={`status status-${r.status}`}>{STATUS_WORDS[r.status]}</td>
                  <td>{r.used === null ? "-" : `${r.used} of ${r.limit}`}</td>
                  <td>{r.until === null ? "-" : `${r.until.label} ${day(r.until.date)}`}</td>
                  <td>{r.reference ?? "-"}</td>
                  <td>{when(r.lastApproval)}</td>
                  <td class="problem">{r.problems.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
