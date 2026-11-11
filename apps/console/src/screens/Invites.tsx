/**
 * Invitations to sign up (PLAN-SUBSCRIBERS §7, S3): every invitation with its plan,
 * trial, expiry and whether it has been used; send one, send it again, revoke it.
 * Each goes through the audited `invite` callable, which emails the sign-up link.
 */
import { useSignal } from "@preact/signals";
import { defaultPlan, INVITE_DAYS, type PlanId, TRIAL_DAYS } from "@sasimem/core";
import type { ConsoleData } from "../data.js";
import { when } from "../format.js";
import type { Invite } from "../types.js";
import { Field, value } from "./Field.js";
import { LOAD_FAILED, useLoad } from "./useLoad.js";

type Send = (request: unknown) => Promise<string | null>;

const terms = (i: Invite): string =>
  i.planId === null ? `Standard, ${TRIAL_DAYS}-day trial` : i.planId === "free" ? "Free" : `${defaultPlan(i.planId).name}, ${i.trialDays ?? TRIAL_DAYS}-day trial`;

function stateOf(i: Invite, now: Date): string {
  if (i.used) return "Signed up";
  if (i.expiresAt !== null && i.expiresAt <= now) return "Expired";
  if (i.lastError !== null) return `Email failed: ${i.lastError}`;
  return i.sendCount === 0 ? "Not emailed" : `Emailed${i.sendCount > 1 ? ` ${i.sendCount} times` : ""}`;
}

export function Invites(props: { data: () => Promise<ConsoleData>; invite: Send; now: () => Date }) {
  const version = useSignal(0);
  const loaded = useLoad(props.data, (d) => d.invites(), String(version.value));
  const problem = useSignal<string | null>(null);
  const done = useSignal<string | null>(null);
  const busy = useSignal(false);
  const email = useSignal("");
  const planId = useSignal<PlanId>("standard");
  const trialDays = useSignal(String(TRIAL_DAYS));
  const lasts = useSignal(String(INVITE_DAYS));

  const send = async (request: Record<string, unknown>, success: string) => {
    busy.value = true;
    done.value = null;
    problem.value = await props.invite(request);
    busy.value = false;
    if (problem.value === null) {
      done.value = success;
      version.value += 1;
    }
  };
  const number = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);
  const submit = (e: Event) => {
    e.preventDefault();
    void send({ kind: "send", email: email.value, planId: planId.value, trialDays: number(trialDays.value), expiresInDays: number(lasts.value) }, `Invitation sent to ${email.value.trim()}.`)
      .then(() => { if (problem.value === null) email.value = ""; });
  };

  return (
    <main>
      <h1>Invites</h1>
      <form class="card" aria-label="Invite someone" onSubmit={submit}>
        <h2>Invite someone</h2>
        <Field label="Email"><input type="email" value={email.value} onInput={(e) => (email.value = value(e))} /></Field>
        <Field label="Plan">
          <select value={planId.value} onChange={(e) => (planId.value = value(e) as PlanId)}>
            <option value="free">Free</option><option value="standard">Standard</option><option value="plus">Plus</option>
          </select>
        </Field>
        {planId.value !== "free" && (
          <Field label="Trial days"><input inputMode="numeric" value={trialDays.value} onInput={(e) => (trialDays.value = value(e))} /></Field>
        )}
        <Field label="Invitation lasts (days)"><input inputMode="numeric" value={lasts.value} onInput={(e) => (lasts.value = value(e))} /></Field>
        <button type="submit" disabled={busy.value}>{busy.value ? "Sending…" : "Send invitation"}</button>
      </form>
      {problem.value !== null && <p role="alert" class="problem">{problem.value}</p>}
      {done.value !== null && <p role="status">{done.value}</p>}

      {loaded.state === "loading" && <p>Loading…</p>}
      {loaded.state === "failed" && <p role="alert">{LOAD_FAILED}</p>}
      {loaded.state === "ready" && (loaded.value.length === 0 ? <p>No invitations yet.</p> : (
        <div class="scroll"><table>
          <thead><tr><th>Email</th><th>Terms</th><th>Invited</th><th>Expires</th><th>State</th><th /></tr></thead>
          <tbody>{loaded.value.map((i) => (
            <tr key={i.email}>
              <td>{i.email}</td><td>{terms(i)}</td><td>{when(i.invitedAt)}</td><td>{i.expiresAt === null ? "-" : when(i.expiresAt)}</td>
              <td class={i.lastError !== null ? "problem" : ""}>{stateOf(i, props.now())}</td>
              <td>{!i.used && (
                <span class="actions">
                  <button type="button" class="quiet" disabled={busy.value} aria-label={`Send again to ${i.email}`}
                    onClick={() => void send({ kind: "send", email: i.email, planId: i.planId ?? "standard", trialDays: i.trialDays ?? TRIAL_DAYS, expiresInDays: INVITE_DAYS }, `Sent again to ${i.email}.`)}>
                    Send again
                  </button>
                  <button type="button" class="quiet" disabled={busy.value} aria-label={`Revoke ${i.email}`}
                    onClick={() => void send({ kind: "revoke", email: i.email }, `Revoked the invitation for ${i.email}.`)}>
                    Revoke
                  </button>
                </span>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
    </main>
  );
}
