import { useSignal } from "@preact/signals";
import type { SignInResult } from "../app.js";
import { Field, value } from "./Field.js";

/** Password first; then the authenticator code when Firebase asks for it. */
export function SignIn(props: { onSignIn: (email: string, password: string) => Promise<SignInResult>; onCode: (code: string) => Promise<string | null> }) {
  const email = useSignal("");
  const password = useSignal("");
  const code = useSignal("");
  const askCode = useSignal(false);
  const problem = useSignal<string | null>(null);
  const busy = useSignal(false);

  const submitPassword = async (e: Event) => {
    e.preventDefault();
    busy.value = true;
    const result = await props.onSignIn(email.value.trim(), password.value);
    busy.value = false;
    problem.value = result.kind === "problem" ? result.message : null;
    askCode.value = result.kind === "code";
  };
  const submitCode = async (e: Event) => {
    e.preventDefault();
    busy.value = true;
    problem.value = await props.onCode(code.value.replace(/\s/g, ""));
    busy.value = false;
  };

  return (
    <main class="narrow">
      <h1>Sasimem console</h1>
      {askCode.value ? (
        <form onSubmit={submitCode}>
          <Field label="Code from your authenticator app">
            <input inputMode="numeric" autocomplete="one-time-code" value={code} onInput={(e) => (code.value = value(e))} required />
          </Field>
          {problem.value !== null && <p role="alert">{problem.value}</p>}
          <button type="submit" disabled={busy}>Continue</button>
        </form>
      ) : (
        <form onSubmit={submitPassword}>
          <Field label="Email">
            <input type="email" autocomplete="email" value={email} onInput={(e) => (email.value = value(e))} required />
          </Field>
          <Field label="Password">
            <input type="password" autocomplete="current-password" value={password} onInput={(e) => (password.value = value(e))} required />
          </Field>
          {problem.value !== null && <p role="alert">{problem.value}</p>}
          <button type="submit" disabled={busy}>Sign in</button>
        </form>
      )}
    </main>
  );
}
