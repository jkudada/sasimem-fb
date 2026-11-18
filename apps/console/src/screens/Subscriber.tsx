import { useSignal } from "@preact/signals";
import type { ConsoleData } from "../data.js";
import { day, kina, STATUS_WORDS, when } from "../format.js";
import { subscriberRow } from "../rows.js";
import { SubscriberActions } from "./SubscriberActions.js";
import { LOAD_FAILED, useLoad } from "./useLoad.js";

const shown = (v: unknown): string => (v === null || v === undefined ? "-" : String(v));

/**
 * One subscriber: what they see is read-only ("view as", D11); the operator's changes
 * are the Actions forms, each an audited callable (S3). A change reloads the page.
 */
export function Subscriber(props: { orgId: string; data: () => Promise<ConsoleData>; operate: (orgId: string, action: unknown) => Promise<string | null>; now: () => Date }) {
  const version = useSignal(0);
  const loaded = useLoad(props.data, (d) => d.subscriber(props.orgId), `${props.orgId}:${version.value}`);
  if (loaded.state === "loading") return <main><p>Loading…</p></main>;
  if (loaded.state === "failed") return <main><p role="alert">{LOAD_FAILED}</p></main>;
  const d = loaded.value;
  if (d === null) return <main><h1>Not found</h1><p>No organisation with that ID. <a href="/">Back to subscribers</a></p></main>;

  const row = subscriberRow({ org: d.org, sub: d.sub, runs: d.runs, emails: d.emails }, props.now());
  const { org, sub } = d;
  return (
    <main>
      <p><a href="/">← Subscribers</a></p>
      <h1>{org.name}</h1>
      {row.problems.length > 0 && <p class="problem">Needs a look: {row.problems.join(", ")}</p>}

      <section aria-label="Organisation" class="card">
        <h2>Organisation</h2>
        <dl>
          <dt>Email</dt><dd>{org.email}</dd>
          <dt>Address</dt><dd>{org.address || "-"}</dd>
          <dt>GST</dt><dd>{org.gstRegistered ? `Registered, ${org.gstNumber}` : "Not registered"}</dd>
          <dt>Signed up</dt><dd>{when(org.createdAt)}</dd>
          <dt>ID</dt><dd><code>{org.id}</code></dd>
        </dl>
      </section>

      <section aria-label="Subscription" class="card">
        <h2>Subscription</h2>
        {sub === null ? <p class="problem">No subscription. Run ops/backfill-subscriptions.ts.</p> : (
          <dl>
            <dt>Plan</dt><dd>{row.plan}, {sub.interval}, {kina(sub.priceToea)} locked</dd>
            <dt>Status</dt><dd>{STATUS_WORDS[row.status]}</dd>
            <dt>Tenancies</dt><dd>{sub.activeTenancyCount} of {sub.tenancyLimit}{sub.limitOverride !== null ? " (limit set by hand)" : ""}</dd>
            <dt>Trial ends</dt><dd>{sub.trialEndsOn === null ? "-" : day(sub.trialEndsOn)}</dd>
            <dt>Paid through</dt><dd>{sub.paidThrough === null ? "-" : day(sub.paidThrough)}</dd>
            <dt>Payment reference</dt><dd>{sub.paymentReference ?? "-"}</dd>
          </dl>
        )}
      </section>

      {sub !== null && (
        <SubscriberActions key={version.value} sub={sub} status={row.status === "none" ? sub.status : row.status} now={props.now}
          operate={(action) => props.operate(org.id, action)} onDone={() => (version.value += 1)} />
      )}

      <section aria-label="Payments" class="card">
        <h2>Payments</h2>
        {d.payments.length === 0 ? <p>None recorded.</p> : (
          <ul>{d.payments.map((p) => <li key={p.id}>{day(p.receivedOn)}: {kina(p.amountToea)}, {p.bankReference}</li>)}</ul>
        )}
      </section>

      <section aria-label="Notes" class="card">
        <h2>Notes</h2>
        {d.notes.length === 0 ? <p>None.</p> : <ul>{d.notes.map((n) => <li key={n.id}>{when(n.at)}, {n.by}: {n.text}</li>)}</ul>}
      </section>

      <section aria-label="Audit trail" class="card">
        <h2>Audit trail</h2>
        {d.events.length === 0 ? <p>No operator changes yet.</p> : (
          <ul>{d.events.map((e) => (
            <li key={e.id}>
              {when(e.at)}: {e.kind} by {e.actorEmail || e.actor}
              {e.changes.length > 0 && <ul>{e.changes.map((c) => <li key={c.field}>{c.field}: {shown(c.before)} → {shown(c.after)}</li>)}</ul>}
            </li>
          ))}</ul>
        )}
      </section>

      <section aria-label="Runs" class="card">
        <h2>Runs</h2>
        {d.runs.length === 0 ? <p>None yet.</p> : (
          <div class="scroll"><table>
            <thead><tr><th>Month</th><th>Status</th><th>Invoices</th><th>Total</th><th>Approved</th></tr></thead>
            <tbody>{d.runs.map((r) => (
              <tr key={r.period}><td>{r.period}</td><td>{r.status}</td><td>{r.invoiceCount}</td><td>{kina(r.totalToea)}</td><td>{when(r.approvedAt)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      {d.runs[0] !== undefined && (
        <section aria-label="Latest invoices" class="card">
          <h2>Invoices, {d.runs[0].period}</h2>
          {d.invoices.length === 0 ? <p>None.</p> : (
            <div class="scroll"><table>
              <thead><tr><th>Number</th><th>Tenant</th><th>Status</th><th>Total</th></tr></thead>
              <tbody>{d.invoices.map((i) => (
                <tr key={i.id}><td>{i.number ?? "-"}</td><td>{i.tenantName}</td><td>{i.status}</td><td>{kina(i.totalToea)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      <section aria-label="Emails, last 30 days" class="card">
        <h2>Emails, last 30 days</h2>
        {d.emails.length === 0 ? <p>None.</p> : (
          <div class="scroll"><table>
            <thead><tr><th>Sent</th><th>Kind</th><th>To</th><th>Result</th></tr></thead>
            <tbody>{d.emails.map((e) => (
              <tr key={e.id}><td>{when(e.sentAt)}</td><td>{e.kind}</td><td>{e.to}</td><td class={e.status === "failed" ? "problem" : ""}>{e.status === "failed" ? `Failed: ${e.error ?? ""}` : "Sent"}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}
