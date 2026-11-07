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
