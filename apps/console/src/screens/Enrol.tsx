import { useSignal } from "@preact/signals";
import { Field, value } from "./Field.js";

/** Set up an authenticator app code: the console shows no data until it is in use (D10). */
export function Enrol(props: {
  email: string;
  onStart: () => Promise<{ key: string; url: string } | { problem: string }>;
  onFinish: (code: string) => Promise<string | null>;
  onSignOut: () => void;
}) {
  const secret = useSignal<{ key: string; url: string } | null>(null);
  const code = useSignal("");
  const problem = useSignal<string | null>(null);
  const busy = useSignal(false);

  const start = async () => {
    busy.value = true;
    const result = await props.onStart();
    busy.value = false;
    if ("problem" in result) problem.value = result.problem;
    else { secret.value = result; problem.value = null; }
  };
  const finish = async (e: Event) => {
    e.preventDefault();
    busy.value = true;
    problem.value = await props.onFinish(code.value.replace(/\s/g, ""));
    busy.value = false;
  };

  return (
    <main class="narrow">
      <h1>Set up your sign-in code</h1>
      <p>The console needs a second step at sign-in: a six-digit code from an authenticator app
        (Google Authenticator, Microsoft Authenticator, 1Password or similar).</p>
      {secret.value === null ? (
        <>
          {problem.value !== null && <p role="alert">{problem.value}</p>}
          <button type="button" onClick={start} disabled={busy}>Set up the code</button>
        </>
      ) : (
        <form onSubmit={finish}>
          <p>Add this key to your authenticator app, as a time-based code:</p>
          <p><code class="key">{secret.value.key}</code></p>
          <p><a href={secret.value.url}>Open in your authenticator app</a> (on the phone that has it).</p>
          <Field label="The code your app now shows">
            <input inputMode="numeric" autocomplete="one-time-code" value={code} onInput={(e) => (code.value = value(e))} required />
          </Field>
          {problem.value !== null && <p role="alert">{problem.value}</p>}
          <button type="submit" disabled={busy}>Finish</button>
          <p class="note">You will then sign in again, with your password and a code.</p>
        </form>
      )}
      <p class="note">Signed in as {props.email}. <button type="button" class="small quiet" onClick={props.onSignOut}>Sign out</button></p>
    </main>
  );
}
