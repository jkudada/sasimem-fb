import { useSignal } from "@preact/signals";
import { type CalendarDate, dateLabel, formatKina, invoiceChip, paidNoteProblem, paidSummary, periodLabel, type Toea, voidReasonProblem } from "@sasimem/core";
import { emailProblem } from "../email-problem.js";
import type { EmailEntry, Month, MonthInvoice, Outcome } from "../setup.js";
import { Back } from "./Back.js";

interface Props {
  month: Month;
  today: CalendarDate;
  onMarkPaid: (invoiceId: string, note: string) => Promise<Outcome>;
  onMarkUnpaid: (invoiceId: string) => Promise<Outcome>;
  onPauseReminders: (invoiceId: string, paused: boolean) => Promise<Outcome>;
  onVoid: (invoiceId: string, reason: string) => Promise<Outcome>;
  onResend: (invoiceId: string) => Promise<Outcome>;
  onOpenPdf: (invoiceId: string) => Promise<Outcome>;
}

type Act = (run: () => Promise<Outcome>) => Promise<void>;

/** A sent month (plan §7, screen 5): who has paid, the paid ticks, the PDFs, and what was emailed. */
export function Tracking(props: Props) {
  const m = props.month;
  const message = useSignal<Outcome | null>(null);
  const busy = useSignal(false);
  const act: Act = async (run) => {
    busy.value = true;
    message.value = await run();
    busy.value = false;
  };
  const issued = m.invoices.filter((i) => i.number !== null);
  const sum = paidSummary(issued);
  return (
    <main class="narrow">
      <Back href="/invoices" label="Invoices" />
      <h1>{periodLabel(m.period)} invoices</h1>
      <p class="total">{sum.paid} of {sum.issued} paid{sum.unpaidToea > 0 && <> · {formatKina(sum.unpaidToea as Toea)} still unpaid</>}</p>
      {message.value !== null && message.value.message !== "" && <p role={message.value.ok ? "status" : "alert"}>{message.value.message}</p>}
      <ul class="invoices">
        {issued.map((inv) => <Row key={inv.id} inv={inv} busy={busy.value} act={act} {...props} />)}
      </ul>
      <EmailLog emails={m.emails ?? []} />
    </main>
  );
}

function Row(props: Props & { inv: MonthInvoice; busy: boolean; act: Act }) {
  const { inv, act } = props;
  const n = inv.number ?? "";
  const chip = invoiceChip({ status: inv.status, dueDate: inv.dueDate ?? props.today }, props.today);
  const note = useSignal("");
  const noteProblem = useSignal<string | null>(null);
  const voiding = useSignal(false);
  const reason = useSignal("");
  const reasonProblem = useSignal<string | null>(null);
  const live = inv.status === "sent" || inv.status === "paid";

  const markPaid = () => {
    noteProblem.value = paidNoteProblem(note.value);
    if (noteProblem.value === null) void act(() => props.onMarkPaid(inv.id, note.value.trim()));
  };
  const doVoid = () => {
    reasonProblem.value = voidReasonProblem(reason.value);
    if (reasonProblem.value === null) void act(() => props.onVoid(inv.id, reason.value.trim()));
  };

  return (
    <li class="card">
      <p><strong>{n} · {inv.tenantName}</strong> · {formatKina(inv.totalToea)}</p>
      <p class="note">{inv.dueDate !== undefined && <>due {dateLabel(inv.dueDate)} · </>}<span class={`chip chip-${chip.toLowerCase().replace(" ", "-")}`}>{chip}</span>{inv.paidNote !== undefined && inv.paidNote !== "" && <> · {inv.paidNote}</>}</p>
      {inv.status === "sent" && (
        <>
          <label class="field">
            <span class="field-label">Note for {n} (optional)</span>
            <input value={note} onInput={(e) => (note.value = (e.currentTarget as HTMLInputElement).value)} />
          </label>
          {noteProblem.value !== null && <p class="field-problem">{noteProblem.value}</p>}
          <button type="button" aria-label={`Mark ${n} paid`} disabled={props.busy} onClick={markPaid}>Mark paid</button>
        </>
      )}
      {inv.status === "paid" && <button type="button" class="quiet" aria-label={`${n} not paid after all`} disabled={props.busy} onClick={() => void act(() => props.onMarkUnpaid(inv.id))}>Not paid after all</button>}
      <div class="actions">
        <button type="button" class="quiet small" aria-label={`PDF of ${n}`} disabled={props.busy} onClick={() => void act(() => props.onOpenPdf(inv.id))}>PDF</button>
        {live && <button type="button" class="quiet small" aria-label={`Email ${n} again`} disabled={props.busy} onClick={() => void act(() => props.onResend(inv.id))}>Email again</button>}
        {inv.status === "sent" && (
          <button type="button" class="quiet small" aria-label={`${inv.remindersPaused === true ? "Resume" : "Pause"} reminders for ${n}`} disabled={props.busy}
            onClick={() => void act(() => props.onPauseReminders(inv.id, inv.remindersPaused !== true))}>
            {inv.remindersPaused === true ? "Resume reminders" : "Pause reminders"}
          </button>
        )}
        {inv.status !== "void" && !voiding.value && <button type="button" class="quiet small" aria-label={`Void ${n}…`} disabled={props.busy} onClick={() => (voiding.value = true)}>Void…</button>}
      </div>
      {voiding.value && (
        <div class="card">
          <label class="field">
            <span class="field-label">Why is {n} void?</span>
            <input value={reason} onInput={(e) => (reason.value = (e.currentTarget as HTMLInputElement).value)} />
          </label>
          {reasonProblem.value !== null && <p class="field-problem">{reasonProblem.value}</p>}
          <p class="note">A void invoice keeps its number and is never sent, reminded or counted as owed. This cannot be undone.</p>
          <button type="button" class="danger" aria-label={`Void ${n}`} disabled={props.busy} onClick={doVoid}>Void invoice</button>
        </div>
      )}
    </li>
  );
}

const KIND: Record<string, string> = {
  approvalDigest: "Approval link", freshLink: "New link", held: "Held notice", dispatch: "Sent notice",
  tenantInvoice: "Invoice", tenantInvoiceAgain: "Invoice, again", reminder: "Reminder",
};

/** What was emailed this month, so a missing email shows up (plan §12: an email log visible in the UI). */
function EmailLog(props: { emails: readonly EmailEntry[] }) {
  if (props.emails.length === 0) return null;
  return (
    <section aria-labelledby="emails">
      <h2 id="emails">Emails</h2>
      <ul class="links">
        {props.emails.map((e) => (
          <li key={e.id}>
            <span>{KIND[e.kind] ?? e.kind}: {e.status === "sent" ? `Sent to ${e.to}` : `Not sent to ${e.to}.`}</span>
            {e.status === "failed" && <span class="field-problem">{emailProblem(e.error)}</span>}
            {e.status === "failed" && e.error !== null && <details class="note"><summary>Details</summary>{e.error}</details>}
          </li>
        ))}
      </ul>
    </section>
  );
}
