/**
 * My account (PLAN-ADMIN-DASHBOARD §8): your role, your name as others see it, and signing
 * out of every device. The name is the one field of your record you write yourself (the
 * rules allow it, with the time you were last seen); signing out everywhere goes through
 * the audited `manageStaff` callable.
 */
import { useSignal } from "@preact/signals";
import { MAX_DISPLAY_NAME, ROLE_NAMES } from "@sasimem/core";
import type { ConsoleData } from "../data.js";
import { when } from "../format.js";
import type { Access, StaffResult } from "../types.js";
import { Field, value } from "./Field.js";
import { LOAD_FAILED, useLoad } from "./useLoad.js";

export function Account(props: { access: Access; data: () => Promise<ConsoleData>; staff: (action: unknown) => Promise<StaffResult>; signOut: () => Promise<void> }) {
  const { access } = props;
  const loaded = useLoad(props.data, (d) => d.own(access.uid));
  const name = useSignal<string | null>(null);
  const problem = useSignal<string | null>(null);
  const done = useSignal<string | null>(null);
  const busy = useSignal(false);

  if (loaded.state === "loading") return <main><h1>My account</h1><p>Loading…</p></main>;
  if (loaded.state === "failed") return <main><h1>My account</h1><p role="alert">{LOAD_FAILED}</p></main>;
  const shownName = name.value ?? loaded.value?.displayName ?? "";

  const save = async (e: Event) => {
    e.preventDefault();
    const n = shownName.trim();
    if (n === "" || n.length > MAX_DISPLAY_NAME) {
      problem.value = `Enter your name (at most ${MAX_DISPLAY_NAME} characters).`;
      return;
    }
    busy.value = true;
    try {
      await (await props.data()).seen(access.uid, n);
      problem.value = null;
      done.value = "Saved.";
    } catch {
      problem.value = "That did not save. Check the connection and try again.";
    }
    busy.value = false;
  };
  const everywhere = async () => {
    busy.value = true;
    const r = await props.staff({ kind: "signOutEverywhere" });
    busy.value = false;
    if (r.ok) await props.signOut();
    else problem.value = r.problem;
  };

  return (
    <main class="narrow">
      <h1>My account</h1>
      <dl class="card">
        <dt>Email</dt><dd>{access.email}</dd>
        <dt>Role</dt><dd>{ROLE_NAMES[access.role]}</dd>
        <dt>Last seen</dt><dd>{when(loaded.value?.lastSeenAt ?? null)}</dd>
      </dl>
      <form class="card" aria-label="Name" onSubmit={save}>
        <Field label="Your name"><input value={shownName} onInput={(e) => (name.value = value(e))} /></Field>
        <button type="submit" disabled={busy.value}>Save</button>
      </form>
      {problem.value !== null && <p role="alert" class="problem">{problem.value}</p>}
      {done.value !== null && <p role="status">{done.value}</p>}
      <section class="card" aria-label="Sign out everywhere">
        <h2>Sign out everywhere</h2>
        <p>Ends your sessions on every device, this one too. Use it if you lost a device or signed in somewhere you should not have.</p>
        <button type="button" class="danger" disabled={busy.value} onClick={() => void everywhere()}>Sign out everywhere</button>
        <p class="note">Lost your authenticator app? Ask an Owner or a Manager to reset your code.</p>
      </section>
    </main>
  );
}
