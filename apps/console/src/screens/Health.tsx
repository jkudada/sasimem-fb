import type { ConsoleData } from "../data.js";
import { when } from "../format.js";
import { healthView } from "../rows.js";
import { LOAD_FAILED, useLoad } from "./useLoad.js";

const time = (at: Date) => at.toLocaleTimeString("en-AU", { timeZone: "Pacific/Port_Moresby", hour: "2-digit", minute: "2-digit" });

export function Health(props: { data: () => Promise<ConsoleData>; now: () => Date }) {
  const loaded = useLoad(props.data, async (d) => {
    const [inputs, tick, subscriptionTick] = await Promise.all([d.subscribers(), d.tick(), d.subscriptionTick()]);
    return { inputs, tick, subscriptionTick };
  });
  if (loaded.state === "loading") return <main><h1>Health</h1><p>Loading…</p></main>;
  if (loaded.state === "failed") return <main><h1>Health</h1><p role="alert">{LOAD_FAILED}</p></main>;
  const h = healthView(loaded.value.inputs, loaded.value.tick, props.now(), loaded.value.subscriptionTick);

  return (
    <main>
      <h1>Health</h1>
      <section aria-label="The hourly tick" class="card">
        <h2>The hourly tick</h2>
        {h.tick === null ? <p class="problem">No successful tick recorded yet.</p>
          : <p class={h.tick.overdue ? "problem" : ""}>Last succeeded {when(h.tick.lastSuccessAt)} at {time(h.tick.lastSuccessAt)} (Port Moresby){h.tick.overdue ? ": more than 3 hours ago." : "."}</p>}
      </section>
      <section aria-label="The daily subscription tick" class="card">
        <h2>The daily subscription tick</h2>
        {h.subscriptionTick === null ? <p class="problem">No successful subscription tick recorded yet.</p>
          : <p class={h.subscriptionTick.overdue ? "problem" : ""}>Last succeeded {when(h.subscriptionTick.lastSuccessAt)} at {time(h.subscriptionTick.lastSuccessAt)} (Port Moresby){h.subscriptionTick.overdue ? ": more than a day ago." : "."}</p>}
      </section>
      <section aria-label="Held runs" class="card">
        <h2>Held runs</h2>
        {h.held.length === 0 ? <p>None.</p> : <ul>{h.held.map((r) => <li key={`${r.orgId}-${r.period}`}><a href={`/s/${r.orgId}`}>{r.name}</a>: {r.period}</li>)}</ul>}
      </section>
      <section aria-label="Failed emails, last 30 days" class="card">
        <h2>Failed emails, last 30 days</h2>
        {h.failedEmails.length === 0 ? <p>None.</p> : (
          <ul>{h.failedEmails.map((e, i) => <li key={i}><a href={`/s/${e.orgId}`}>{e.name}</a>: {e.kind} to {e.to}, {when(e.sentAt)}. {e.error}</li>)}</ul>
        )}
      </section>
      <section aria-label="No approval in 2 months" class="card">
        <h2>No approval in 2 months</h2>
        {h.quiet.length === 0 ? <p>None.</p> : <ul>{h.quiet.map((q) => <li key={q.orgId}><a href={`/s/${q.orgId}`}>{q.name}</a>: last approval {when(q.lastApproval)}</li>)}</ul>}
      </section>
    </main>
  );
}
