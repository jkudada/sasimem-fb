import { useSignal } from "@preact/signals";
import { MAX_LOGO_BYTES, type OrgProfile, firstInvoiceNumberProblem, logoProblem, logoTypeProblem, profileProblems } from "@sasimem/core";
import { shrinkLogo } from "../logo/shrink.js";
import type { Numbering, Org } from "../setup.js";
import { Icon, type IconName } from "./icons.js";
import { Back } from "./Back.js";
import { Field, value } from "./Field.js";
import { whole } from "./read.js";

type Problems = ReturnType<typeof profileProblems>;

/** How the next invoice number will print (plan §6.3: prefix + zero-pad(4)). */
const printed = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, "0")}`;

/** Settings (plan §7, screen 7): letterhead, logo, bank, GST, timing, and where numbering starts. */
export function Settings(props: {
  org: Org;
  numbering: Numbering | null;
  logoUrl: string | null;
  onSave: (profile: OrgProfile) => Promise<string | null>;
  onUploadLogo: (file: File) => Promise<string | null>;
  onRemoveLogo: () => Promise<string | null>;
  onSetNext: (next: number) => Promise<string | null>;
  /** Makes a picture over 200 KB smaller; tests pass a fake, as there is no canvas outside a browser. */
  shrink?: (file: File) => Promise<File>;
}) {
  const o = props.org;
  const name = useSignal(o.name);
  const address = useSignal(o.address);
  const email = useSignal(o.email);
  const gstRegistered = useSignal(o.gstRegistered);
  const gstNumber = useSignal(o.gstNumber);
  const bankName = useSignal(o.bankName);
  const bankAccount = useSignal(o.bankAccount);
  const invoicePrefix = useSignal(o.invoicePrefix);
  const leadDays = useSignal(String(o.approvalLeadDays));
  const sendHour = useSignal(String(o.sendHour));
  const reminderDays = useSignal(String(o.reminderAfterDays));
  const remind = useSignal(o.reminderMode === "auto");
  const problems = useSignal<Problems>({});
  const message = useSignal<string | null>(null);
  const logoMessage = useSignal<string | null>(null);
  const busy = useSignal(false);

  const save = async (e: Event) => {
    e.preventDefault();
    const profile: OrgProfile = {
      name: name.value.trim(), address: address.value.trim(), email: email.value.trim(),
      gstRegistered: gstRegistered.value, gstNumber: gstRegistered.value ? gstNumber.value.trim() : "",
      bankName: bankName.value.trim(), bankAccount: bankAccount.value.trim(), invoicePrefix: invoicePrefix.value.trim(),
      timezone: o.timezone,
      approvalLeadDays: whole(leadDays.value), sendHour: whole(sendHour.value), reminderAfterDays: whole(reminderDays.value),
      reminderMode: remind.value ? "auto" : "off",
    };
    problems.value = profileProblems(profile);
    message.value = null;
    if (Object.keys(problems.value).length > 0) return;
    busy.value = true;
    message.value = (await props.onSave(profile)) ?? "Saved. Invoices already approved keep the details they were issued with.";
    busy.value = false;
  };

  const pickLogo = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const picked = input.files?.[0];
    if (picked === undefined) return;
    busy.value = true;
    const problem = await uploadLogo(picked);
    busy.value = false;
    logoMessage.value = problem ?? "Logo saved.";
    // A file that was not saved does not stay in the box, looking as if it had been.
    if (problem !== null) input.value = "";
  };

  /** A picture over 200 KB is made smaller first; null once it is saved, else what went wrong. */
  const uploadLogo = async (picked: File): Promise<string | null> => {
    const wrongKind = logoTypeProblem(picked.type);
    if (wrongKind !== null) return wrongKind;
    let file = picked;
    if (file.size > MAX_LOGO_BYTES) {
      logoMessage.value = "Making your logo smaller...";
      try {
        file = await (props.shrink ?? shrinkLogo)(file);
      } catch (err) {
        return err instanceof Error ? err.message : "That picture could not be made smaller.";
      }
    }
    return logoProblem(file) ?? (await props.onUploadLogo(file));
  };

  const p = problems.value;
  const numbering = props.numbering;
  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Settings</h1>
      <div class="settings">
        <form onSubmit={save} noValidate>
          <h2>On your invoices</h2>
          <Field label="Name on your invoices" problem={p.name}>
            <input value={name} onInput={(e) => (name.value = value(e))} />
          </Field>
          <Field label="Your address" problem={p.address}>
            <input value={address} onInput={(e) => (address.value = value(e))} />
          </Field>
          <Field label="Your email" hint="Approval links come here." problem={p.email}>
            <input type="email" value={email} onInput={(e) => (email.value = value(e))} />
          </Field>
          <Field label="Invoice number prefix" hint="Such as INV-." problem={p.invoicePrefix}>
            <input value={invoicePrefix} onInput={(e) => (invoicePrefix.value = value(e))} />
          </Field>
          <h2>GST and bank</h2>
          <label class="check">
            <input type="checkbox" checked={gstRegistered} onChange={(e) => (gstRegistered.value = (e.currentTarget as HTMLInputElement).checked)} />
            I am registered for GST
          </label>
          {gstRegistered.value && (
            <Field label="GST number" problem={p.gstNumber}>
              <input value={gstNumber} onInput={(e) => (gstNumber.value = value(e))} />
            </Field>
          )}
          <Field label="Bank name" problem={p.bankName}>
            <input value={bankName} onInput={(e) => (bankName.value = value(e))} />
          </Field>
          <Field label="Bank account number" hint="Tenants pay into this account." problem={p.bankAccount}>
            <input value={bankAccount} onInput={(e) => (bankAccount.value = value(e))} />
          </Field>
          <p class="note">Sasimem works out GST for you, but it is a tool, not an accountant.</p>
          <h2>Timing</h2>
          <Field label="Days before sending that you are asked to approve" problem={p.approvalLeadDays}>
            <input inputMode="numeric" value={leadDays} onInput={(e) => (leadDays.value = value(e))} />
          </Field>
          <Field label="Hour to send invoices" hint="0 to 23, Port Moresby time. 8 means 8 in the morning." problem={p.sendHour}>
            <input inputMode="numeric" value={sendHour} onInput={(e) => (sendHour.value = value(e))} />
          </Field>
          <label class="check">
            <input type="checkbox" checked={remind} onChange={(e) => (remind.value = (e.currentTarget as HTMLInputElement).checked)} />
            Remind tenants who have not paid (once)
          </label>
          {remind.value && (
            <Field label="Days after the due date to send the reminder" problem={p.reminderAfterDays}>
              <input inputMode="numeric" value={reminderDays} onInput={(e) => (reminderDays.value = value(e))} />
            </Field>
          )}
          {message.value !== null && <p role="status">{message.value}</p>}
          <button type="submit" disabled={busy}>Save settings</button>
        </form>

        <div class="settings-side">
          <section class="card">
            <h2>Logo</h2>
            {props.logoUrl !== null && <img class="logo" src={props.logoUrl} alt="Your logo" />}
            <Field label="Logo (optional)" hint="A PNG, JPEG, WebP or GIF. A big picture is made smaller for you. It goes on future invoices.">
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void pickLogo(e)} />
            </Field>
            <p><a href="/settings/logo">{o.logoDesign === undefined ? "Design a logo" : "Change your logo design"}</a></p>
            {o.logoPath === undefined && <p class="note">No logo yet? Make one from your initials or name, a shape and an icon.</p>}
            {logoMessage.value !== null && <p role="status">{logoMessage.value}</p>}
            {o.logoPath !== undefined && (
              <button type="button" class="quiet" disabled={busy} onClick={async () => (logoMessage.value = (await props.onRemoveLogo()) ?? "Logo removed.")}>Remove logo</button>
            )}
          </section>

          <h2 class="section-title">Your Sasimem plan</h2>
          <LinkTile href="/settings/billing" icon="plan" title="Plan & billing" hint="Your plan, how to pay, and your payments." />

          <h2 class="section-title">How your invoices look</h2>
          <LinkTile href="/settings/templates" icon="invoices" title="Invoice templates" hint="Choose a layout, colour, font and a note for your invoices." />

          <section class="card">
            <h2>Invoice numbers</h2>
            {numbering === null && <p class="note">Loading… You need a connection to see this.</p>}
            {numbering?.started === true && (
              <p>Your next invoice will be {printed(o.invoicePrefix, numbering.next)}. Invoices have already been numbered, so this cannot change: numbers stay in one unbroken sequence.</p>
            )}
            {numbering?.started === false && <NextNumber next={numbering.next} prefix={o.invoicePrefix} onSetNext={props.onSetNext} />}
          </section>
        </div>
      </div>
    </main>
  );
}

/** A link to another settings screen, as a tile like home's menu: named by its title, its hint as the description. */
function LinkTile(props: { href: string; icon: IconName; title: string; hint: string }) {
  const id = `settings-${props.icon}`;
  return (
    <a class="tile" href={props.href} aria-labelledby={id} aria-describedby={`${id}-hint`}>
      <span class="tile-icon"><Icon name={props.icon} /></span>
      <span class="tile-text">
        <span class="tile-title" id={id}>{props.title}</span>
        <span class="tile-hint" id={`${id}-hint`}>{props.hint}</span>
      </span>
      <Icon name="arrow" class="tile-go" />
    </a>
  );
}

/** Where numbering starts. Mounted once the number has loaded, so the field starts with it. */
function NextNumber(props: { next: number; prefix: string; onSetNext: (next: number) => Promise<string | null> }) {
  const next = useSignal(String(props.next));
  const problem = useSignal<string | null>(null);
  const saved = useSignal<string | null>(null);
  const busy = useSignal(false);

  const save = async (e: Event) => {
    e.preventDefault();
    const n = whole(next.value);
    saved.value = null;
    problem.value = firstInvoiceNumberProblem(n);
    if (problem.value !== null) return;
    busy.value = true;
    problem.value = await props.onSetNext(n);
    if (problem.value === null) saved.value = `Saved. Your next invoice will be ${printed(props.prefix, n)}.`;
    busy.value = false;
  };

  return (
    <form onSubmit={save} noValidate>
      <Field label="Number for your next invoice" hint="If you have already sent invoices by hand, enter the next number, such as 142. This can change only until your first approval." problem={problem.value ?? undefined}>
        <input inputMode="numeric" value={next} onInput={(e) => (next.value = value(e))} />
      </Field>
      {saved.value !== null && <p role="status">{saved.value}</p>}
      <button type="submit" disabled={busy}>Save number</button>
    </form>
  );
}
