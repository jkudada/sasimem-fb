import { useSignal } from "@preact/signals";

/**
 * After sign-up, before an organisation (docs/PLAN-TEMPLATES.md §7): confirm the email
 * address, so nobody can send invoices as Sasimem from an address they do not own.
 */
export function VerifyEmail(props: {
  email: string;
  onCheck: () => Promise<boolean>;
  onResend: () => Promise<string | null>;
  onSignOut: () => Promise<void>;
}) {
  const message = useSignal<string | null>(null);
  const busy = useSignal(false);

  const act = async (run: () => Promise<string | null>) => {
    busy.value = true;
    message.value = await run();
    busy.value = false;
  };

  return (
    <main class="narrow">
      <h1>Check your email</h1>
      <p>We sent a link to <strong>{props.email}</strong>. Open it to confirm this is your address, then come back here.</p>
      <button type="button" disabled={busy} onClick={() => void act(async () =>
        (await props.onCheck()) ? null : "Not confirmed yet. Open the link in the email, then try again.")}>
        I have opened the link
      </button>
      <button type="button" class="quiet" disabled={busy} onClick={() => void act(async () =>
        (await props.onResend()) ?? "Sent again. Check your inbox, and your spam folder.")}>
        Send the link again
      </button>
      {message.value !== null && <p role="status">{message.value}</p>}
      <p class="note">Wrong address? Sign out and create the account again with the right one.</p>
      <button type="button" class="quiet small" onClick={() => void props.onSignOut()}>Sign out</button>
    </main>
  );
}
