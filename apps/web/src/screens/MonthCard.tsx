import { useSignal } from "@preact/signals";
import { type Period, formatKina, paidSummary, periodLabel } from "@sasimem/core";
import type { Month, Outcome } from "../setup.js";
import { sendLabel } from "./when.js";

/** Home's one action for this month (plan §7, screen 3). */
export function MonthCard(props: { period: Period; month: Month | null; timezone: string; onDraftNow: (p: Period) => Promise<Outcome> }) {
  const message = useSignal<Outcome | null>(null);
  const busy = useSignal(false);
  const label = periodLabel(props.period);
  const name = label.split(" ")[0] ?? label;
  const m = props.month;
  const review = `/month/${props.period}`;

  const draftNow = async () => {
    busy.value = true;
    message.value = await props.onDraftNow(props.period);
    busy.value = false;
  };

  let body;
  if (m === null) {
    body = (
      <>
        <p>{label}'s invoices are not drafted yet. Sasimem drafts them before they are due and emails you a link to approve.</p>
        <button type="button" disabled={busy} onClick={() => void draftNow()}>Generate {name}'s invoices now</button>
      </>
    );
  } else if (m.status === "held") {
    body = (
      <>
        <p class="warn">{label}'s invoices were not sent, because they were not approved in time.</p>
        <a class="button" href={review}>Held - approve now</a>
      </>
    );
  } else if (m.status === "draft" || m.status === "awaitingApproval") {
    body = (
      <>
        <p>{m.invoiceCount} {m.invoiceCount === 1 ? "invoice" : "invoices"}, {formatKina(m.totalToea)}, waiting for your approval. Nothing goes out before {sendLabel(m.sendAt, props.timezone)}.</p>
        <a class="button" href={review}>Review {m.invoiceCount} {m.invoiceCount === 1 ? "invoice" : "invoices"}</a>
      </>
    );
  } else if (m.status === "approved") {
    body = <p class="ok">Approved - goes out at {sendLabel(m.sendAt, props.timezone)}.</p>;
  } else if (m.status === "sent") {
    const sum = paidSummary(m.invoices);
    body = (
      <>
        <p class="ok">Sent to your tenants. {sum.paid === sum.issued ? "All paid." : `${sum.paid} of ${sum.issued} paid.`}</p>
        <a class="button" href={review}>See who has paid</a>
      </>
    );
  } else {
    body = <p>{label}'s invoices were cancelled.</p>;
  }

  return (
    <section aria-labelledby="this-month" class="card">
      <h2 id="this-month">{label}</h2>
      {body}
      {message.value !== null && <p role={message.value.ok ? "status" : "alert"}>{message.value.message}</p>}
    </section>
  );
}
