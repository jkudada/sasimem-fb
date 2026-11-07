import { useSignal } from "@preact/signals";
import { type OrgSetupInput, orgProblems, withOrgDefaults } from "@sasimem/core";
import { Field, value } from "./Field.js";

type Problems = ReturnType<typeof orgProblems>;

/** Onboarding, part 1: the details printed on every invoice (plan §7, screen 2). */
export function OrgStep(props: { defaultEmail: string; onSubmit: (input: OrgSetupInput) => Promise<string | null> }) {
  const name = useSignal("");
  const address = useSignal("");
  const email = useSignal(props.defaultEmail);
  const gstRegistered = useSignal(false);
  const gstNumber = useSignal("");
  const bankName = useSignal("");
  const bankAccount = useSignal("");
  const firstNumber = useSignal("1");
  const problems = useSignal<Problems>({});
  const failure = useSignal<string | null>(null);
  const busy = useSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    const input: OrgSetupInput = {
      name: name.value.trim(), address: address.value.trim(), email: email.value.trim(),
      gstRegistered: gstRegistered.value, gstNumber: gstRegistered.value ? gstNumber.value.trim() : "",
      bankName: bankName.value.trim(), bankAccount: bankAccount.value.trim(),
      firstInvoiceNumber: /^\d+$/.test(firstNumber.value.trim()) ? Number(firstNumber.value.trim()) : Number.NaN,
    };
    problems.value = orgProblems(withOrgDefaults(input));
    if (Object.keys(problems.value).length > 0) return;
    busy.value = true;
    failure.value = await props.onSubmit(input);
    busy.value = false;
  };

  const p = problems.value;
  return (
    <main class="narrow">
      <h1>Your details</h1>
      <p>These go on every invoice. You can change them later in Settings.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Name on your invoices" problem={p.name}>
          <input value={name} onInput={(e) => (name.value = value(e))} />
        </Field>
        <Field label="Your address" problem={p.address}>
          <input value={address} onInput={(e) => (address.value = value(e))} />
        </Field>
        <Field label="Your email" hint="Approval links come here." problem={p.email}>
          <input type="email" value={email} onInput={(e) => (email.value = value(e))} />
        </Field>
        <label class="check">
          <input type="checkbox" checked={gstRegistered} onChange={(e) => (gstRegistered.value = (e.currentTarget as HTMLInputElement).checked)} />
          I am registered for GST
        </label>
        {gstRegistered.value && (
          <Field label="GST number" problem={p.gstNumber}>
            <input value={gstNumber} onInput={(e) => (gstNumber.value = value(e))} />
          </Field>
        )}
        <Field label="Bank name" problem={p.bankName}>
          <input value={bankName} onInput={(e) => (bankName.value = value(e))} />
        </Field>
        <Field label="Bank account number" hint="Tenants pay into this account." problem={p.bankAccount}>
          <input value={bankAccount} onInput={(e) => (bankAccount.value = value(e))} />
        </Field>
        <Field label="Number for your next invoice" hint="Start at 1. If you have already sent invoices by hand, enter the next number, such as 142." problem={p.firstInvoiceNumber}>
          <input inputMode="numeric" value={firstNumber} onInput={(e) => (firstNumber.value = value(e))} />
        </Field>
        <p class="note">Sasimem works out GST for you, but it is a tool, not an accountant.</p>
        {failure.value !== null && <p role="alert">{failure.value}</p>}
        <button type="submit" disabled={busy}>Continue</button>
      </form>
    </main>
  );
}
