/**
 * Settings (PLAN-ADMIN-DASHBOARD §5): the Owner's and Managers' switches. Everyone sees
 * them; only the roles core's SETTING_EDITORS names can change each. A change goes
 * through the audited `updateSettings` callable at once, then the console reloads the
 * settings, since some change what pages show.
 */
import { useSignal } from "@preact/signals";
import { type ConsoleSettings, ROLE_NAMES, SETTING_EDITORS, type SettingKey } from "@sasimem/core";
import { useEffect } from "preact/hooks";
import type { Access, StaffListing, StaffResult } from "../types.js";

type Flag = Exclude<SettingKey, "summaryRecipients">;
const FLAGS: readonly { key: Flag; label: string; hint: string }[] = [
  { key: "managersSeeNames", label: "Managers see customers' names", hint: "Off: Managers see customers by ID only. Owners, Supervisors and Support always see names." },
  { key: "showRentVolume", label: "Show the total rent invoiced", hint: "One system-wide total, rounded to K1,000, never per customer. (Shown on the Overview from phase A3.)" },
  { key: "viewAsEnabled", label: "Allow \"view as\" a customer", hint: "On: the Owner and Support can open a customer's own records, giving a reason each time, and every view is audited. (From phase A2.)" },
  { key: "staffEmailSeparate", label: "Keep staff and landlord emails separate", hint: "On: a landlord's email cannot be invited as staff, and a staff email cannot sign up as a landlord." },
];

/** "an Owner", "an Owner or a Manager". */
const editors = (key: SettingKey): string =>
  SETTING_EDITORS[key].map((r) => `${r === "owner" ? "an" : "a"} ${ROLE_NAMES[r]}`).join(" or ");

export function Settings(props: { access: Access; staff: (action: unknown) => Promise<StaffResult>; update: (change: unknown) => Promise<string | null>; onChanged: () => void }) {
  const { role, settings } = props.access;
  const problem = useSignal<string | null>(null);
  const busy = useSignal(false);
  const people = useSignal<readonly StaffListing[]>([]);
  const mayEdit = (key: SettingKey) => SETTING_EDITORS[key].includes(role);
  const chosen = useSignal<readonly string[]>(settings.summaryRecipients ?? []);
  const everyManager = useSignal(settings.summaryRecipients === null);

  useEffect(() => {
    if (mayEdit("summaryRecipients")) void props.staff({ kind: "list" }).then((r) => { if (r.ok) people.value = (r.staff ?? []).filter((s) => s.status === "active"); });
  }, []);

  const change = async (c: Partial<ConsoleSettings>) => {
    busy.value = true;
    problem.value = await props.update(c);
    busy.value = false;
    if (problem.value === null) props.onChanged();
  };

  return (
    <main>
      <h1>Settings</h1>
      <section class="card" aria-label="Switches">
        {FLAGS.map((f) => (
          <div key={f.key}>
            <label class="check">
              <input type="checkbox" checked={settings[f.key]} disabled={busy.value || !mayEdit(f.key)}
                onChange={(e) => void change({ [f.key]: (e.currentTarget as HTMLInputElement).checked })} />
              {f.label}
            </label>
            <p class="note">{f.hint} {mayEdit(f.key) ? "" : `Only ${editors(f.key)} can change this.`}</p>
          </div>
        ))}
      </section>

      <section class="card" aria-label="Monthly summary">
        <h2>Monthly summary email</h2>
        <p class="note">Sent on the 1st of each month from phase A5.</p>
        {!mayEdit("summaryRecipients") ? (
          <p>{settings.summaryRecipients === null ? "Goes to every Manager." : `Goes to ${settings.summaryRecipients.length} chosen ${settings.summaryRecipients.length === 1 ? "person" : "people"}.`} Only {editors("summaryRecipients")} can change this.</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void change({ summaryRecipients: everyManager.value ? null : chosen.value }); }}>
            <label class="check"><input type="radio" name="who" checked={everyManager.value} onChange={() => (everyManager.value = true)} /> Every Manager</label>
            <label class="check"><input type="radio" name="who" checked={!everyManager.value} onChange={() => (everyManager.value = false)} /> These people:</label>
            {!everyManager.value && (
              <fieldset aria-label="Recipients">
                {people.value.map((p) => (
                  <label class="check" key={p.uid}>
                    <input type="checkbox" checked={chosen.value.includes(p.uid)}
                      onChange={(e) => (chosen.value = (e.currentTarget as HTMLInputElement).checked ? [...chosen.value, p.uid] : chosen.value.filter((u) => u !== p.uid))} />
                    {p.displayName || p.email} ({ROLE_NAMES[p.role]})
                  </label>
                ))}
              </fieldset>
            )}
            <button type="submit" disabled={busy.value}>Save recipients</button>
          </form>
        )}
      </section>
      {problem.value !== null && <p role="alert" class="problem">{problem.value}</p>}
    </main>
  );
}
