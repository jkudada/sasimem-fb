import { useSignal } from "@preact/signals";
import { Field, value } from "./Field.js";

export function ResetPassword({ onReset }: { onReset: (email: string) => Promise<void> }) {
  const email = useSignal("");
  const sent = useSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    // The same answer whether or not the account exists, so the form cannot be used to find accounts.
    await onReset(email.value.trim()).catch(() => undefined);
    sent.value = true;
  };

  return (
    <main class="narrow">
      <h1>Reset your password</h1>
      <form onSubmit={submit}>
        <Field label="Email">
          <input type="email" autocomplete="email" value={email} onInput={(e) => (email.value = value(e))} required />
        </Field>
        {sent.value && <p role="status">If there is an account for that email, a reset link is on its way. Check your inbox.</p>}
        <button type="submit">Send reset link</button>
      </form>
      <p><a href="/">Back to sign in</a></p>
    </main>
  );
}
