/**
 * Settings → Plan & billing (PLAN-SUBSCRIBERS §8, S4), a lazy route: the plan, how many
 * tenancies it allows, the status and its dates, how to pay Sasimem, the payments Sasimem
 * has recorded, and "Ask to change plan". Export and cancel arrive with S6.
 */
import { useSignal } from "@preact/signals";
import {
  type CalendarDate, dateLabel, defaultPlan, formatKina, howToPay, type Interval, type PlanId, STATUS_LABELS, subscriptionStatus, usageText,
} from "@sasimem/core";
import { useEffect } from "preact/hooks";
import type { Outcome, Setup, SubscriptionPayment } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { SubscriptionBanner } from "./SubscriptionBanner.js";

export function PlanBilling(props: {
  setup: Setup;
  today: CalendarDate;
  loadPayments: () => Promise<readonly SubscriptionPayment[] | string>;
  onAsk: (planId: PlanId, interval: Interval, message: string) => Promise<Outcome>;
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
      </dl>

      {!free && (
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

      <AskToChange current={sub.planId} interval={sub.interval} onAsk={props.onAsk} />
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
