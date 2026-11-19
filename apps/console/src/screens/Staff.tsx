/**
 * Staff (PLAN-ADMIN-DASHBOARD §9): who has the console, in which role, whether their code
 * is set up and when they were last seen; invite, change role, suspend, reactivate,
 * remove, reset their code, send the invitation again. Every change goes through the
 * audited `manageStaff` callable, which decides; this page only offers what core's
 * rolesAssignableBy says the reader may do, and never on themselves.
 */
import { useSignal } from "@preact/signals";
import { ROLE_NAMES, rolesAssignableBy, type StaffRole } from "@sasimem/core";
import { useEffect } from "preact/hooks";
import { when } from "../format.js";
import type { Access, StaffListing, StaffResult } from "../types.js";
import { Field, value } from "./Field.js";

type Manage = (action: unknown) => Promise<StaffResult>;

const STATUS: Record<StaffListing["status"], string> = { active: "Active", suspended: "Suspended", removed: "Removed" };
const seen = (iso: string | null): string => (iso === null ? "Never" : when(new Date(iso)));

function Row(props: { s: StaffListing; access: Access; busy: boolean; act: (action: Record<string, unknown>, done: string) => void }) {
  const { s, access, act } = props;
  const assignable = rolesAssignableBy(access.role);
  const role = useSignal<StaffRole>(s.role);
  const confirming = useSignal(false);
  const mine = s.uid === access.uid;
  const mayManage = !mine && s.status !== "removed" && assignable.includes(s.role);
  const who = s.displayName || s.email;
  return (
    <tr>
      <td>{s.displayName}{mine && " (you)"}</td><td>{s.email}</td><td>{ROLE_NAMES[s.role]}</td>
      <td class={s.status === "active" ? "" : "problem"}>{STATUS[s.status]}</td>
      <td>{s.codeSetUp ? "Yes" : "Not yet"}</td><td>{seen(s.lastSeenAt)}</td>
      <td>{mayManage && (
        <span class="actions">
          <select aria-label={`Role for ${who}`} value={role.value} onChange={(e) => (role.value = value(e) as StaffRole)}>
            {assignable.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
          </select>
          {role.value !== s.role && (
            <button type="button" class="quiet" disabled={props.busy} onClick={() => act({ kind: "changeRole", uid: s.uid, role: role.value }, `${who} is now ${ROLE_NAMES[role.value]}.`)}>
              Change role
            </button>
          )}
          {s.status === "active"
            ? <button type="button" class="quiet" disabled={props.busy} aria-label={`Suspend ${who}`} onClick={() => act({ kind: "suspend", uid: s.uid }, `Suspended ${who}.`)}>Suspend</button>
            : <button type="button" class="quiet" disabled={props.busy} aria-label={`Reactivate ${who}`} onClick={() => act({ kind: "reactivate", uid: s.uid }, `Reactivated ${who}.`)}>Reactivate</button>}
          {s.status === "active" && s.lastSeenAt === null && (
            <button type="button" class="quiet" disabled={props.busy} aria-label={`Send the invitation again to ${who}`} onClick={() => act({ kind: "resendInvite", uid: s.uid }, `Sent again to ${s.email}.`)}>Send again</button>
          )}
          {s.codeSetUp && (
            <button type="button" class="quiet" disabled={props.busy} aria-label={`Reset the code for ${who}`} onClick={() => act({ kind: "resetMfa", uid: s.uid }, `${who} sets up a new code at their next sign-in.`)}>Reset code</button>
          )}
          {confirming.value
            ? <button type="button" class="quiet danger" disabled={props.busy} onClick={() => act({ kind: "remove", uid: s.uid }, `Removed ${who}.`)}>Yes, remove {who}</button>
            : <button type="button" class="quiet" disabled={props.busy} aria-label={`Remove ${who}`} onClick={() => (confirming.value = true)}>Remove</button>}
        </span>
      )}</td>
    </tr>
  );
}

export function Staff(props: { access: Access; staff: Manage; now: () => Date }) {
  const version = useSignal(0);
  const list = useSignal<readonly StaffListing[] | "loading" | string>("loading");
  const problem = useSignal<string | null>(null);
  const done = useSignal<string | null>(null);
  const busy = useSignal(false);
  const showRemoved = useSignal(false);
  const name = useSignal("");
  const email = useSignal("");
  const assignable = rolesAssignableBy(props.access.role);
  const role = useSignal<StaffRole>("viewer");

  useEffect(() => {
    props.staff({ kind: "list" }).then((r) => (list.value = r.ok ? (r.staff ?? []) : r.problem));
  }, [version.value]);

  const act = async (action: Record<string, unknown>, success: string): Promise<boolean> => {
    busy.value = true;
    done.value = null;
    const r = await props.staff(action);
    busy.value = false;
    problem.value = r.ok ? null : r.problem;
    if (r.ok) {
      done.value = success;
      version.value += 1;
    }
    return r.ok;
  };
  const submit = (e: Event) => {
    e.preventDefault();
    void act({ kind: "invite", email: email.value, displayName: name.value, role: role.value }, `Invited ${email.value.trim()} as ${ROLE_NAMES[role.value]}. They get an email to choose a password.`)
      .then((ok) => { if (ok) { name.value = ""; email.value = ""; } });
  };

  const rows = typeof list.value === "string" ? [] : list.value.filter((s) => showRemoved.value || s.status !== "removed");
  return (
    <main>
      <h1>Staff</h1>
      <form class="card" aria-label="Invite staff" onSubmit={submit}>
        <h2>Invite staff</h2>
        <Field label="Name"><input value={name.value} onInput={(e) => (name.value = value(e))} /></Field>
        <Field label="Email"><input type="email" value={email.value} onInput={(e) => (email.value = value(e))} /></Field>
        <Field label="Role" {...(props.access.role === "manager" ? { hint: "Only an Owner can add an Owner or a Manager." } : {})}>
          <select value={role.value} onChange={(e) => (role.value = value(e) as StaffRole)}>
            {assignable.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
          </select>
        </Field>
        <button type="submit" disabled={busy.value}>{busy.value ? "Saving…" : "Send invitation"}</button>
      </form>
      {problem.value !== null && <p role="alert" class="problem">{problem.value}</p>}
      {done.value !== null && <p role="status">{done.value}</p>}

      {list.value === "loading" && <p>Loading…</p>}
      {typeof list.value === "string" && list.value !== "loading" && <p role="alert">{list.value}</p>}
      {typeof list.value !== "string" && (
        <>
          <label class="check"><input type="checkbox" checked={showRemoved.value} onChange={(e) => (showRemoved.value = (e.currentTarget as HTMLInputElement).checked)} /> Show removed staff</label>
          <div class="scroll"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Code set up</th><th>Last seen</th><th /></tr></thead>
            <tbody>{rows.map((s) => <Row key={`${s.uid}:${s.role}:${s.status}`} s={s} access={props.access} busy={busy.value} act={(a, m) => void act(a, m)} />)}</tbody>
          </table></div>
        </>
      )}
    </main>
  );
}
