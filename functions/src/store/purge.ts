/**
 * Purge (PLAN-SUBSCRIBERS §10 step 4, §11, D12; S6): 90 days after a cancel, the org is
 * deleted, all but its issued invoices. Those, and their PDFs, are copied first to the
 * retention bucket, which keeps them 7 years and which no client can reach; if any copy
 * fails, the purge stops before deleting anything and the next day's tick tries again.
 *
 * Then, in an order that is safe to repeat from any point: the audit entry, the owner's
 * sign-in and their user record, the org's files, its links, the org's tree, and last the
 * subscription, which is how the tick finds the org, so an interrupted purge is resumed.
 */
import { Timestamp } from "firebase-admin/firestore";
import { auth, bucket, db } from "../admin.js";
import { exportLinks } from "./exports.js";
import { SUBSCRIPTION_TICK, subscriptionRef } from "./subscriptions.js";

type Bucket = ReturnType<typeof bucket>;

export interface Purged {
  readonly name: string;
  /** Issued invoices kept in the retention bucket. */
  readonly invoices: number;
  readonly pdfs: number;
}

/** Firestore values as JSON: timestamps as ISO text. */
const plain = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};
const json = (v: unknown): Buffer => Buffer.from(`${JSON.stringify(plain(v), null, 2)}\n`, "utf8");

/** Copy the org's profile, issued invoices and their PDFs to `retention`. Throws on any failure. */
async function keep(orgId: string, retention: Bucket): Promise<Purged> {
  const org = db().doc(`orgs/${orgId}`);
  const [profile, invoices] = await Promise.all([org.get(), org.collection("invoices").where("number", "!=", null).get()]);
  const at = (name: string) => retention.file(`orgs/${orgId}/${name}`);
  const save = (name: string, data: Buffer, contentType: string) => at(name).save(data, { contentType, resumable: false });

  await save("org.json", json({ id: orgId, ...profile.data() }), "application/json");
  let pdfs = 0;
  for (const d of invoices.docs) {
    await save(`invoices/${d.id}.json`, json({ id: d.id, ...d.data() }), "application/json");
    const path = d.get("pdfPath") as string | undefined;
    if (path !== undefined && path !== "") {
      const [pdf] = await bucket().file(path).download();
      await save(`invoices/${d.id}.pdf`, pdf, "application/pdf");
      pdfs++;
    }
  }
  return { name: String(profile.get("name") ?? orgId), invoices: invoices.size, pdfs };
}

const gone = (e: unknown): boolean => (e as { code?: unknown }).code === "auth/user-not-found";

/** Purge one org. Returns what was kept; null when an earlier run had already kept it, or there was nothing to purge. */
export async function purgeOrg(orgId: string, now: Date, retention: Bucket): Promise<Purged | null> {
  const sub = subscriptionRef(orgId);
  if (!(await sub.get()).exists) return null;
  const org = db().doc(`orgs/${orgId}`);
  // An earlier run that got as far as deleting the org kept everything first: finish its work.
  const kept = (await org.get()).exists ? await keep(orgId, retention) : null;

  // The audit entry outlives everything else.
  if (kept !== null) {
    await db().collection("operatorEvents").doc(`purge-${orgId}`).set({
      kind: "purged", orgId, actor: SUBSCRIPTION_TICK, actorEmail: null, at: now,
      before: { status: "cancelled" }, after: { status: "purged" },
      detail: { ...kept, retentionBucket: retention.name },
    });
  }

  const members = await org.collection("members").get();
  for (const m of members.docs) {
    await auth().deleteUser(m.id).catch((e: unknown) => { if (!gone(e)) throw e; });
    await db().doc(`users/${m.id}`).delete();
  }
  for (const prefix of ["invoices", "logos", "exports"]) await bucket().deleteFiles({ prefix: `${prefix}/${orgId}/` });
  for (const links of [db().collection("approvalTokens"), exportLinks()]) {
    const found = await links.where("orgId", "==", orgId).get();
    await Promise.all(found.docs.map((d) => d.ref.delete()));
  }
  await db().recursiveDelete(org);
  await db().recursiveDelete(sub);
  return kept;
}
