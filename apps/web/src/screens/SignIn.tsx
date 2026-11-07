import { useSignal } from "@preact/signals";
import { Field, value } from "./Field.js";

/** Resolves with a plain-English problem, or null when signed in. */
export type SignInAction = (email: string, password: string) => Promise<string | null>;

export function SignIn({ onSignIn }: { onSignIn: SignInAction }) {
  const email = useSignal("");
  const password = useSignal("");
  const problem = useSignal<string | null>(null);
  const busy = useSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    busy.value = true;
    problem.value = await onSignIn(email.value.trim(), password.value);
    busy.value = false;
  };

  return (
    <main class="narrow">
      <h1>Sasimem</h1>
      <form onSubmit={submit}>
        <Field label="Email">
          <input type="email" autocomplete="email" value={email} onInput={(e) => (email.value = value(e))} required />
        </Field>
        <Field label="Password">
          <input type="password" autocomplete="current-password" value={password} onInput={(e) => (password.value = value(e))} required />
        </Field>
        {problem.value !== null && <p role="alert">{problem.value}</p>}
        <button type="submit" disabled={busy}>Sign in</button>
      </form>
      <p><a href="/sign-up">Create an account</a> · <a href="/reset">Forgot your password?</a></p>
    </main>
  );
}
