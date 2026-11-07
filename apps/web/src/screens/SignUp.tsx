import { useSignal } from "@preact/signals";
import { Field, value } from "./Field.js";
import type { SignInAction } from "./SignIn.js";

const MIN_PASSWORD = 6; // Firebase Auth's own minimum

export function SignUp({ onSignUp }: { onSignUp: SignInAction }) {
  const email = useSignal("");
  const password = useSignal("");
  const problem = useSignal<string | null>(null);
  const busy = useSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (password.value.length < MIN_PASSWORD) {
      problem.value = "Use a password of at least 6 characters.";
      return;
    }
    busy.value = true;
    problem.value = await onSignUp(email.value.trim(), password.value);
    busy.value = false;
  };

  return (
    <main class="narrow">
      <h1>Create your account</h1>
      <form onSubmit={submit}>
        <Field label="Email">
          <input type="email" autocomplete="email" value={email} onInput={(e) => (email.value = value(e))} required />
        </Field>
        <Field label="Password" hint="At least 6 characters.">
          <input type="password" autocomplete="new-password" value={password} onInput={(e) => (password.value = value(e))} required />
        </Field>
        {problem.value !== null && <p role="alert">{problem.value}</p>}
        <button type="submit" disabled={busy}>Create account</button>
      </form>
      <p><a href="/">I already have an account</a></p>
    </main>
  );
}
