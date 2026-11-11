/**
 * T4 helpers: read and nudge the Firestore emulator directly (admin access via the
 * emulator's "Bearer owner"), so a journey can follow an emailed link.
 */
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";

const DOCS = "http://127.0.0.1:8080/v1/projects/demo-sasimem/databases/(default)/documents";
const OWNER = { Authorization: "Bearer owner" };

interface OutboxDoc { fields: { to: { stringValue: string }; text: { stringValue: string }; at: { timestampValue: string } } }

/** Every approval link mailed to an address so far, oldest first (Firestore lists by random ID). */
async function mailedLinks(email: string): Promise<string[]> {
  const res = await fetch(`${DOCS}/_outbox?pageSize=300`, { headers: OWNER });
  const body = (await res.json()) as { documents?: OutboxDoc[] };
  return (body.documents ?? [])
    .filter((d) => d.fields.to.stringValue === email)
    .sort((a, b) => a.fields.at.timestampValue.localeCompare(b.fields.at.timestampValue))
    .flatMap((d) => /https?:\/\/\S+\/a\/[A-Za-z0-9_-]+/.exec(d.fields.text.stringValue) ?? []);
}

/** The approval links mailed to an address, once at least `atLeast` have landed. */
export async function linksMailedTo(email: string, atLeast = 1): Promise<string[]> {
  await expect.poll(async () => (await mailedLinks(email)).length, { message: `approval links mailed to ${email}` }).toBeGreaterThanOrEqual(atLeast);
  return mailedLinks(email);
}

/** Expire a link now, as seven days passing would (I10). */
export async function expire(link: string): Promise<void> {
  const token = link.split("/a/")[1] ?? "";
  const id = createHash("sha256").update(token).digest("hex");
  const res = await fetch(`${DOCS}/approvalTokens/${id}?updateMask.fieldPaths=expiresAt`, {
    method: "PATCH", headers: { ...OWNER, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { expiresAt: { timestampValue: "2000-01-01T00:00:00Z" } } }),
  });
  if (!res.ok) throw new Error(`could not expire the link: ${res.status}`);
}

/** The path of a link, so the browser opens it on the Hosting emulator. */
export const pathOf = (link: string): string => new URL(link).pathname;

/** The landlord's org ID, found by the email on its profile. */
async function orgIdOf(email: string): Promise<string> {
  const res = await fetch(`${DOCS}:runQuery`, {
    method: "POST", headers: { ...OWNER, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "orgs" }], where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email } } } } }),
  });
  const rows = (await res.json()) as { document?: { name: string } }[];
  const name = rows.find((r) => r.document !== undefined)?.document?.name;
  if (name === undefined) throw new Error(`no org for ${email}`);
  return name.split("/").pop() ?? "";
}

/** Move every run of the landlord's org to a send time an hour ago, as waiting for the 28th would. */
export async function sendTimeHasPassed(email: string): Promise<void> {
  const orgId = await orgIdOf(email);
  const runs = (await (await fetch(`${DOCS}/orgs/${orgId}/runs`, { headers: OWNER })).json()) as { documents?: { name: string }[] };
  const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  for (const run of runs.documents ?? []) {
    const path = run.name.split("/documents/")[1] ?? "";
    const res = await fetch(`${DOCS}/${path}?updateMask.fieldPaths=sendAt`, {
      method: "PATCH", headers: { ...OWNER, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { sendAt: { timestampValue: anHourAgo } } }),
    });
    if (!res.ok) throw new Error(`could not move the send time: ${res.status}`);
  }
}

/**
 * Fire the real scheduled tick, as Cloud Scheduler would. The Functions emulator loads a
 * scheduled function only with the Pub/Sub emulator running, but firebase-tools 15.25's
 * Pub/Sub bridge refuses v2 schedules ("Unsupported trigger signature: http"), so this
 * posts to the trigger's endpoint directly - the same request the bridge would make.
 */
export async function runTheTick(): Promise<void> {
  const res = await fetch("http://127.0.0.1:5001/functions/projects/demo-sasimem/triggers/australia-southeast1-tick-0", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  if (!res.ok) throw new Error(`could not fire the tick: ${res.status}`);
}

interface Mailed { subject: string; attachments: { filename: string; bytes: number }[] }

/** The mail an address has received since a moment, once a subject matching `subject` has landed. */
export async function mailTo(email: string, since: Date, subject: RegExp): Promise<Mailed> {
  const find = async (): Promise<Mailed | undefined> => {
    const body = (await (await fetch(`${DOCS}/_outbox?pageSize=300`, { headers: OWNER })).json()) as { documents?: { fields: Record<string, { stringValue?: string; timestampValue?: string; arrayValue?: { values?: { mapValue: { fields: Record<string, { stringValue?: string; integerValue?: string }> } }[] } }> }[] };
    return (body.documents ?? [])
      .map((d) => d.fields)
      .filter((f) => f["to"]?.stringValue === email && (f["at"]?.timestampValue ?? "") >= since.toISOString() && subject.test(f["subject"]?.stringValue ?? ""))
      .map((f) => ({
        subject: f["subject"]?.stringValue ?? "",
        attachments: (f["attachments"]?.arrayValue?.values ?? []).map((v) => ({ filename: v.mapValue.fields["filename"]?.stringValue ?? "", bytes: Number(v.mapValue.fields["bytes"]?.integerValue ?? 0) })),
      }))[0];
  };
  await expect.poll(async () => (await find()) !== undefined, { message: `mail to ${email} matching ${subject}`, timeout: 30_000 }).toBe(true);
  return (await find()) as Mailed;
}

/** The template frozen into each of the landlord's invoices, as stored. */
export async function frozenTemplatesOf(email: string): Promise<Record<string, string>[]> {
  const orgId = await orgIdOf(email);
  type Value = { stringValue?: string; mapValue?: { fields?: Record<string, Value> } };
  const res = (await (await fetch(`${DOCS}/orgs/${orgId}/invoices`, { headers: OWNER })).json()) as { documents?: { fields: Record<string, Value> }[] };
  return (res.documents ?? []).map((d) => {
    const template = d.fields["snapshot"]?.mapValue?.fields?.["template"]?.mapValue?.fields ?? {};
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, v.stringValue ?? ""]));
  });
}

/** The org's logo fields as stored: the path, and whether a builder design is kept beside it. */
export async function logoOf(email: string): Promise<{ orgId: string; logoPath: string | null; designed: boolean }> {
  const orgId = await orgIdOf(email);
  const doc = (await (await fetch(`${DOCS}/orgs/${orgId}`, { headers: OWNER })).json()) as { fields: Record<string, { stringValue?: string }> };
  return { orgId, logoPath: doc.fields["logoPath"]?.stringValue ?? null, designed: "logoDesign" in doc.fields };
}

/** A file's bytes from the Storage emulator, read as an admin. */
export async function storedFile(path: string): Promise<Buffer> {
  const res = await fetch(`http://127.0.0.1:9199/v0/b/demo-sasimem.appspot.com/o/${encodeURIComponent(path)}?alt=media`, { headers: OWNER });
  if (!res.ok) throw new Error(`no file at ${path}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Each invoice's rendered PDF path, empty until the PDF is rendered. */
export async function pdfPathsOf(email: string): Promise<string[]> {
  const orgId = await orgIdOf(email);
  const res = (await (await fetch(`${DOCS}/orgs/${orgId}/invoices`, { headers: OWNER })).json()) as { documents?: { fields: Record<string, { stringValue?: string }> }[] };
  return (res.documents ?? []).map((d) => d.fields["pdfPath"]?.stringValue ?? "");
}

/** Invite an email to sign up, as ops/invite.ts does on a real project (docs/PLAN-TEMPLATES.md §7). */
export async function invite(email: string): Promise<void> {
  const res = await fetch(`${DOCS}/signupInvites/${encodeURIComponent(email.toLowerCase())}`, {
    method: "PATCH", headers: { ...OWNER, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { invitedAt: { timestampValue: new Date().toISOString() } } }),
  });
  if (!res.ok) throw new Error(`could not invite ${email}: ${res.status}`);
}

/** Open the confirmation link the Auth emulator "sent" to an address, as the landlord would. */
export async function confirmEmail(email: string): Promise<void> {
  const codes = "http://127.0.0.1:9099/emulator/v1/projects/demo-sasimem/oobCodes";
  type Code = { email: string; requestType: string; oobLink: string };
  const find = async () => ((await (await fetch(codes)).json()) as { oobCodes?: Code[] }).oobCodes?.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL").pop();
  await expect.poll(async () => (await find()) !== undefined, { message: `a confirmation link for ${email}` }).toBe(true);
  const res = await fetch((await find())?.oobLink ?? "");
  if (!res.ok) throw new Error(`the confirmation link did not work: ${res.status}`);
}

/** Change fields of the landlord's subscription, as an operator action or the passing days would (PLAN-SUBSCRIBERS S4). */
export async function setSubscription(email: string, fields: Record<string, number | string>): Promise<void> {
  const orgId = await orgIdOf(email);
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const value = (v: number | string) => (typeof v === "number" ? { integerValue: String(v) } : { stringValue: v });
  const res = await fetch(`${DOCS}/subscriptions/${orgId}?${mask}`, {
    method: "PATCH", headers: { ...OWNER, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, value(v)])) }),
  });
  if (!res.ok) throw new Error(`could not change the subscription: ${res.status}`);
}
