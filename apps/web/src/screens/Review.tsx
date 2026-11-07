import { useSignal } from "@preact/signals";
import { type Period, type Toea, formatKina, isEditable, periodLabel } from "@sasimem/core";
import type { Month, MonthInvoice, Outcome } from "../setup.js";
import { Back } from "./Back.js";
import { readKina } from "./read.js";
import { sendLabel } from "./when.js";

interface Props {
  month: Month;
  timezone: string;
  onSetRent: (invoiceId: string, rentToea: Toea) => Promise<Outcome>;
  onExclude: (invoiceId: string) => Promise<Outcome>;
  onInclude: (invoiceId: string) => Promise<Outcome>;
  onRebuild: (period: Period) => Promise<Outcome>;
  onApprove: (period: Period) => Promise<Outcome>;
}

/** A month's invoices before approval: rents, who is in, rebuild, approve. Same callables as the page. */
export function Review(props: Props) {
  const m = props.month;
  const message = useSignal<Outcome | null>(null);
  const busy = useSignal(false);
  const confirmRebuild = useSignal(false);
  const editable = isEditable(m.status);
  const included = m.invoices.filter((i) => i.status === "draft");

  const act = async (run: () => Promise<Outcome>) => {
    busy.value = true;
    message.value = await run();
    busy.value = false;
  };

  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>{periodLabel(m.period)} invoices</h1>
      {m.status === "held" && <p class="warn">These were not sent at {sendLabel(m.sendAt, props.timezone)} because they were not approved. Approve now and they go out within the hour.</p>}
      {(m.status === "draft" || m.status === "awaitingApproval") && <p>Check each rent, untick anyone not to invoice this month, then approve. Nothing is sent before {sendLabel(m.sendAt, props.timezone)}.</p>}
      {m.status === "approved" && <p class="ok">Approved - goes out at {sendLabel(m.sendAt, props.timezone)}.</p>}
      <ul class="invoices">
        {m.invoices.map((inv) => <Row key={inv.id} inv={inv} editable={editable} busy={busy.value} act={act} {...props} />)}
      </ul>
      <p class="total">Total <strong>{formatKina(m.totalToea)}</strong></p>
      {message.value !== null && message.value.message !== "" && <p role={message.value.ok ? "status" : "alert"}>{message.value.message}</p>}
      {editable && (
        <>
          <button type="button" disabled={busy} onClick={() => void act(() => props.onApprove(m.period))}>
            Approve {included.length} {included.length === 1 ? "invoice" : "invoices"}
          </button>
          {!confirmRebuild.value && <button type="button" class="quiet" disabled={busy} onClick={() => (confirmRebuild.value = true)}>Rebuild from tenancy details</button>}
          {confirmRebuild.value && (
            <div class="card">
              <p>This redrafts the month from your tenancies as they are now. It discards any rent you changed for this month. Tenants you left out stay out.</p>
              <button type="button" class="danger" disabled={busy} onClick={() => { confirmRebuild.value = false; void act(() => props.onRebuild(m.period)); }}>Rebuild anyway</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Row(props: Props & { inv: MonthInvoice; editable: boolean; busy: boolean; act: (run: () => Promise<Outcome>) => Promise<void> }) {
  const { inv } = props;
  const rent = useSignal(formatKina(inv.rentToea));
  const problem = useSignal<string | null>(null);
  const saveRent = () => {
    const read = readKina(rent.value);
    if ("problem" in read) {
      problem.value = read.problem;
      return;
    }
    problem.value = null;
    void props.act(() => props.onSetRent(inv.id, read.toea));
  };
  return (
    <li class="card">
      <p><strong>{inv.tenantName}</strong> · {inv.unitLabel}{inv.number !== null && <> · {inv.number}</>}</p>
      {props.editable ? (
        <>
          <div class="row">
            <label class="field">
              <span class="field-label">Rent for {inv.tenantName}</span>
              <input inputMode="decimal" value={rent} onInput={(e) => (rent.value = (e.currentTarget as HTMLInputElement).value)} />
            </label>
            <button type="button" class="quiet small" aria-label={`Save rent for ${inv.tenantName}`} disabled={props.busy} onClick={saveRent}>Save</button>
          </div>
          {problem.value !== null && <p class="field-problem">{problem.value}</p>}
          <label class="check">
            <input type="checkbox" aria-label={`Invoice ${inv.tenantName} this month`} checked={inv.status === "draft"} disabled={props.busy}
              onChange={() => void props.act(() => (inv.status === "draft" ? props.onExclude(inv.id) : props.onInclude(inv.id)))} />
            Invoice this month
          </label>
        </>
      ) : null}
      <p class="note">{inv.status === "excluded" ? "Left out this month" : `Total ${formatKina(inv.totalToea)}`}</p>
    </li>
  );
}
