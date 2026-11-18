/**
 * Settings → Plan & billing (PLAN-SUBSCRIBERS §8, S4), a lazy route: the plan, how many
 * tenancies it allows, the status and its dates, how to pay Sasimem, the payments Sasimem
 * has recorded, and "Ask to change plan". S6: "Export everything" (#export, which the
 * cancellation email links to) and "Cancel subscription", asked twice.
 */
import { useSignal } from "@preact/signals";
import {
  type CalendarDate, dateLabel, defaultPlan, formatKina, howToPay, type Interval, type PlanId, STATUS_LABELS, subscriptionStatus, usageText,
} from "@sasimem/core";
import { useEffect } from "preact/hooks";
import type { ExportOutcome, Outcome, Setup, SubscriptionPayment } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { SubscriptionBanner } from "./SubscriptionBanner.js";

export function PlanBilling(props: {
  setup: Setup;
  today: CalendarDate;
  loadPayments: () => Promise<readonly SubscriptionPayment[] | string>;
  onAsk: (planId: PlanId, interval: Interval, message: string) => Promise<Outcome>;
  onExport: () => Promise<ExportOutcome>;
  onCancel: () => Promise<Outcome>;
}) {
  const sub = props.setup.subscription ?? null;
  const payments = useSignal<readonly SubscriptionPayment[] | string | null>(null);
  useEffect(() => void props.loadPayments().then((p) => (payments.value = p)), []);

  if (sub === null) {
    return (
      <main class="narrow">
        <Back href="/settings" label="Settings" />
        <h1>Plan & billing</h1>
        <p>Your plan could not be loaded. Check your signal, then reload the page.</p>
      </main>
    );
  }
  const status = subscriptionStatus(sub, props.today);
  const plan = defaultPlan(sub.planId);
  const free = sub.planId === "free";
  const p = payments.value;
  const ended = status === "cancelled" || status === "purged";

  return (
    <main class="narrow">
      <Back href="/settings" label="Settings" />
      <h1>Plan & billing</h1>
      <SubscriptionBanner setup={props.setup} today={props.today} />

      <dl class="facts">
        <dt>Plan</dt><dd>{plan.name}{free ? "" : `, ${formatKina(sub.priceToea)} ${sub.interval === "annual" ? "a year" : "a month, paid three months at a time"}`}</dd>
        <dt>Tenancies</dt><dd>{usageText(sub)}</dd>
        <dt>Status</dt><dd>{STATUS_LABELS[status]}</dd>
        {sub.trialEndsOn !== null && status === "trial" && <><dt>Trial ends</dt><dd>{dateLabel(sub.trialEndsOn)}</dd></>}
        {sub.paidThrough !== null && <><dt>Paid through</dt><dd>{dateLabel(sub.paidThrough)}</dd></>}
        {sub.paymentReference !== null && <><dt>Your payment reference</dt><dd>{sub.paymentReference}</dd></>}
        {ended && sub.purgeAfter !== null && <><dt>Records deleted on</dt><dd>{dateLabel(sub.purgeAfter)}</dd></>}
      </dl>

      {!free && !ended && (
        <>
          <h2>How to pay</h2>
          <p>{howToPay(sub, props.setup.bank ?? null)}</p>
          <p class="note">Sasimem records your payment when it reaches the bank, usually within two working days.</p>
        </>
      )}

      <h2>Payments</h2>
      {p === null && <p class="note">Loading…</p>}
      {typeof p === "string" && <p role="alert">{p}</p>}
      {Array.isArray(p) && (p.length === 0 ? <p class="note">No payments yet.</p> : (
        <ul class="units">
          {p.map((x) => (
            <li key={x.id}>{formatKina(x.amountToea)} on {dateLabel(x.receivedOn)} ({x.bankReference}), for {dateLabel(x.coversFrom)} to {dateLabel(x.coversTo)}</li>
          ))}
        </ul>
      ))}

      {!ended && <AskToChange current={sub.planId} interval={sub.interval} onAsk={props.onAsk} />}
      <ExportEverything onExport={props.onExport} />
      {!ended && <CancelSubscription onCancel={props.onCancel} />}
    </main>
  );
}

function AskToChange(props: { current: PlanId; interval: Interval; onAsk: (planId: PlanId, interval: Interval, message: string) => Promise<Outcome> }) {
  const planId = useSignal<PlanId>(props.current === "plus" ? "standard" : "plus");
  const interval = useSignal<Interval>(props.interval);
  const message = useSignal("");
  const outcome = useSignal<Outcome | null>(null);
  const busy = useSignal(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    busy.value = true;
    outcome.value = await props.onAsk(planId.value, interval.value, message.value);
    busy.value = false;
  };
  return (
    <form id="change" class="card" aria-label="Ask to change plan" onSubmit={submit}>
      <h2>Ask to change plan</h2>
      <p class="note">Sasimem changes your plan and replies by email. A smaller plan never ends a tenancy; it stops new ones above its limit.</p>
      <Field label="Plan">
        <select value={planId.value} onChange={(e) => (planId.value = value(e) as PlanId)}>
          {(["free", "standard", "plus"] as const).map((id) => {
            const p = defaultPlan(id);
            return <option key={id} value={id}>{`${p.name}: up to ${p.tenancyLimit} tenancies${id === "free" ? "" : `, ${formatKina(p.priceToeaAnnual)} a year`}`}</option>;
          })}
        </select>
      </Field>
      {planId.value !== "free" && (
        <Field label="Pay">
          <select value={interval.value} onChange={(e) => (interval.value = value(e) as Interval)}>
            <option value="annual">Once a year (two months free)</option>
            <option value="monthly">Every three months</option>
          </select>
        </Field>
      )}
      <Field label="Message (optional)">
        <textarea rows={3} maxLength={1000} value={message.value} onInput={(e) => (message.value = (e.currentTarget as HTMLTextAreaElement).value)} />
      </Field>
      {outcome.value !== null && <p role={outcome.value.ok ? "status" : "alert"}>{outcome.value.message}</p>}
      <button type="submit" disabled={busy.value || outcome.value?.ok === true}>{busy.value ? "Sending…" : "Ask to change plan"}</button>
    </form>
  );
}

function ExportEverything(props: { onExport: () => Promise<ExportOutcome> }) {
  const outcome = useSignal<ExportOutcome | null>(null);
  const busy = useSignal(false);
  const run = async () => {
    busy.value = true;
    outcome.value = await props.onExport();
    busy.value = false;
  };
  const o = outcome.value;
  return (
    <section id="export" class="card" aria-labelledby="export-h">
      <h2 id="export-h">Export everything</h2>
      <p class="note">A zip of your properties, tenants, tenancies, invoices and payments as spreadsheets (CSV), with every invoice PDF.</p>
      {o !== null && <p role={o.ok ? "status" : "alert"}>{o.message}</p>}
      {o?.ok === true && o.url !== undefined && <p class="note"><a href={o.url}>Download it again</a> (the link works for an hour).</p>}
      <button type="button" disabled={busy.value} onClick={() => void run()}>{busy.value ? "Preparing…" : "Export everything"}</button>
    </section>
  );
}

function CancelSubscription(props: { onCancel: () => Promise<Outcome> }) {
  const asking = useSignal(false);
  const busy = useSignal(false);
  const problem = useSignal<string | null>(null);
  const cancel = async () => {
    busy.value = true;
    const o = await props.onCancel();
    busy.value = false;
    problem.value = o.ok ? null : o.message;
  };
  if (!asking.value) {
    return <button type="button" class="danger" onClick={() => (asking.value = true)}>Cancel subscription</button>;
  }
  return (
    <section class="card" aria-labelledby="cancel-h">
      <h2 id="cancel-h">Cancel subscription</h2>
      <p>No new month will be drafted. Months already approved still go out. Your records are kept, read-only, for 90 days, then deleted: export them first if you want a copy.</p>
      {problem.value !== null && <p role="alert">{problem.value}</p>}
      <button type="button" class="danger" disabled={busy.value} onClick={() => void cancel()}>{busy.value ? "Cancelling…" : "Yes, cancel my subscription"}</button>
      <button type="button" class="quiet" disabled={busy.value} onClick={() => (asking.value = false)}>Keep my subscription</button>
    </section>
  );
}
