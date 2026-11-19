/**
 * A credit note (docs/PLAN-GENERAL-INVOICING.md AR-3; G2c): how much of each line of an
 * issued invoice to credit, why, and where the money goes. Core works out the GST and the
 * limits; pressing Issue is the say-so for the email too.
 */
import { useSignal } from "@preact/signals";
import {
  type CreditLineInput, type CreditNoteInput, type Toea, afterCreditNote, creditNoteLines, creditNoteProblems, creditNoteTitle, formatKina, leftOnLine, wholeInvoice,
} from "@sasimem/core";
import type { CreditableRow, Outcome } from "../setup.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { readKina } from "./read.js";

export function CreditNoteForm(props: {
  invoice: CreditableRow;
  creditNoteId: string;
  onIssue: (creditNoteId: string, input: CreditNoteInput, emailIt: boolean) => Promise<Outcome>;
}) {
  const inv = props.invoice;
  const typed = useSignal<Readonly<Record<number, string>>>({});
  const reason = useSignal("");
  const emailIt = useSignal(true);
  const problems = useSignal<ReturnType<typeof creditNoteProblems>>({});
  const unreadable = useSignal<Readonly<Record<number, string>>>({});
  const failure = useSignal<string | null>(null);
  const done = useSignal<string | null>(null);
  const busy = useSignal(false);

  const left = (n: number) => leftOnLine(inv.lines[n] as (typeof inv.lines)[number], inv.creditNotedLines?.[n]).amountToea;

  /** The lines as typed; blanks are left out, unreadable ones reported by line. */
  const read = () => {
    const bad: Record<number, string> = {};
    const lines: CreditLineInput[] = [];
    inv.lines.forEach((_, n) => {
      const text = (typed.value[n] ?? "").trim();
      if (text === "") return;
      const r = readKina(text);
      if ("problem" in r) bad[n] = r.problem;
      else lines.push({ lineIndex: n, amountToea: r.toea });
    });
    return { lines, bad };
  };

  if (done.value !== null) {
    return (
      <main class="narrow">
        <Back href="/credit-notes" label="Credit notes" />
        <h1>Credit note issued</h1>
        <p role="status">{done.value}</p>
        <p><a class="button" href="/credit-notes">See all credit notes</a></p>
      </main>
    );
  }

  const fullyCredited = (inv.creditNotedToea ?? 0) >= inv.totalToea;
  if (inv.number === null || (inv.status !== "sent" && inv.status !== "paid") || fullyCredited) {
    return (
      <main class="narrow">
        <Back href="/credit-notes" label="Credit notes" />
        <h1>Credit {inv.number ?? "an invoice"}</h1>
        <p>{fullyCredited ? `${inv.number ?? "This invoice"} has been credited in full already.` : "Only a sent or paid invoice can be credited."}</p>
      </main>
    );
  }

  const { lines, bad } = read();
  const input: CreditNoteInput = { invoiceId: inv.id, reason: reason.value, lines };
  const sound = Object.keys(bad).length === 0 && creditNoteProblems(input, inv).lines === undefined;
  const preview = sound ? afterCreditNote(inv, input) : null;
  const totals = Object.keys(bad).length === 0 ? creditNoteLines(input, inv).totals : null;

  const submit = async (e: Event) => {
    e.preventDefault();
    failure.value = null;
    unreadable.value = bad;
    problems.value = creditNoteProblems(input, inv);
    if (Object.keys(bad).length > 0 || Object.keys(problems.value).length > 0) return;
    busy.value = true;
    const outcome = await props.onIssue(props.creditNoteId, { ...input, reason: reason.value.trim() }, emailIt.value);
    busy.value = false;
    if (outcome.ok) done.value = outcome.message;
    else failure.value = outcome.message;
  };
  const whole = () => {
    typed.value = Object.fromEntries(wholeInvoice(inv).map((l) => [l.lineIndex, formatKina(l.amountToea)]));
  };

  return (
    <main class="narrow">
      <Back href="/credit-notes" label="Credit notes" />
      <h1>Credit {inv.number} · {inv.customerName}</h1>
      <p class="note">A {creditNoteTitle(inv).toLowerCase()} takes money off an invoice that has been sent. The invoice itself never changes.</p>
      <form onSubmit={submit} noValidate>
        <fieldset class="card">
          <legend>What to credit</legend>
          <p class="note">Amounts before GST. Leave a line blank to credit none of it.</p>
          {inv.lines.map((l, n) => left(n) === 0 ? (
            <p key={n} class="note">{l.description}: credited in full already.</p>
          ) : (
            <Field key={n} label={`Credit on ${l.description}`} hint={`${formatKina(left(n))} of ${formatKina(l.amountToea)} left to credit.`} problem={unreadable.value[n]}>
              <input inputMode="decimal" value={typed.value[n] ?? ""} onInput={(e) => (typed.value = { ...typed.value, [n]: value(e) })} />
            </Field>
          ))}
          <button type="button" class="quiet small" onClick={whole}>Credit the whole invoice</button>
          {problems.value.lines !== undefined && <p class="field-problem">{problems.value.lines}</p>}
          {totals !== null && totals.totalToea !== 0 && (
            <p class="total">Credit note {formatKina(totals.totalToea)}{totals.gstToea !== 0 && ` (GST ${formatKina(totals.gstToea)})`}</p>
          )}
          {preview !== null && preview.appliedToea > 0 && <p class="note">{formatKina(preview.appliedToea)} comes off what {inv.number} owes.</p>}
          {preview !== null && preview.creditToea > 0 && <p class="note">{formatKina(preview.creditToea as Toea)} is kept as credit for {inv.customerName}, for their next invoice.</p>}
        </fieldset>
        <Field label="Reason" hint="Prints on the credit note, like “Two lights returned”." problem={problems.value.reason}>
          <input value={reason} onInput={(e) => (reason.value = value(e))} />
        </Field>
        <label class="check">
          <input type="checkbox" checked={emailIt} onChange={(e) => (emailIt.value = (e.currentTarget as HTMLInputElement).checked)} />
          Email it to them
        </label>
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Issue credit note</button>
      </form>
    </main>
  );
}
