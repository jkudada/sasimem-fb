/**
 * Export, cancel, reinstate and purge (PLAN-SUBSCRIBERS §11, S6; docs/test-lists/subscribers.md).
 * Orgs come from the real createOrg on 1 September 2026, a Standard trial to 30 October;
 * aSentMonth's October invoices were approved on 28 September and sent on 1 October.
 * Purge tests each use their own purge day, as the operator digest is claimed once a day.
 */
import { parsePeriod } from "@sasimem/core";
import { getAuth } from "firebase-admin/auth";
import { beforeAll, describe, expect, test } from "vitest";
import { bucket, retentionBucket } from "../src/admin.js";
import { makeBillingCallables } from "../src/callables/billing.js";
import { makeOperatorCallables } from "../src/callables/operator.js";
import { handleExportDownload } from "../src/http/exportDownload.js";
import { approveRun } from "../src/store/approval.js";
import { setPaid } from "../src/store/payments.js";
import { renderMissingPdfs } from "../src/store/pdfs.js";
import { draftRun } from "../src/store/runs.js";
import { storeOperatorAction } from "../src/store/subscriptions.js";
import { runSubscriptionTick, type SubscriptionTickDeps } from "../src/subscriptionTick.js";
import { runTick } from "../src/tick.js";
import { asStaff, OPERATOR, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { anOrgWith, aSentMonth } from "./harness/seed.js";
import { unzip } from "./harness/unzip.js";

const LANDLORD = "mary@wari.example";
const OCT = parsePeriod("2026-10");
const NOV = parsePeriod("2026-11");
const T0 = new Date("2026-10-05T00:00:00Z"); // 10 am, 5 October, Port Moresby
const MIN = 60_000;
const at6 = (day: string) => new Date(`${day}T06:00:00+10:00`);
const RETENTION = "sasimem-test-retention";
/** Tests that build whole sent months, and zip or purge them. */
const SLOW = 20_000;

function setUp(start = T0) {
  let now = start;
  const mailer = new FakeMailer();
  const deps = { now: () => now, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example", fallbackContact: () => "ops@sasimem.example" };
  const billing = makeBillingCallables(deps);
  const tickDeps: SubscriptionTickDeps = { ...deps, retention: () => retentionBucket(RETENTION) };
  // The handler names the zip; the function streams it from Storage, as this reads it.
  const fetch = async (url: string) => {
    const res = await handleExportDownload({ method: "GET", path: new URL(url).pathname }, { now: () => now });
    return res.file === undefined ? res : { ...res, body: (await bucket().file(res.file).download())[0] };
  };
  return {
    mailer, deps, tickDeps, fetch,
    at: (t: Date) => { now = t; },
    exportAs: (uid: string | null, orgId: string) => billing.exportEverything.run(request(uid, { orgId })),
    cancelAs: (uid: string | null, orgId: string) => billing.cancelSubscription.run(request(uid, { orgId }, { email: LANDLORD })),
    operator: (orgId: string, action: Record<string, unknown>) => makeOperatorCallables(deps).operatorAction.run(request("op-uid", { orgId, action }, OPERATOR)),
    subscriptionTick: (t: Date, orgIds: string[], over: Partial<SubscriptionTickDeps> = {}) => { now = t; return runSubscriptionTick({ ...tickDeps, ...over }, { orgIds }); },
  };
}

const sub = (orgId: string) => adminDb().doc(`subscriptions/${orgId}`);
const subOf = async (orgId: string) => (await sub(orgId).get()).data() ?? {};
const eventsOf = async (orgId: string) => (await adminDb().collection("operatorEvents").where("orgId", "==", orgId).get()).docs.map((d) => d.data());
const invoicesOf = async (orgId: string) => (await adminDb().collection(`orgs/${orgId}/invoices`).get()).docs;
const files = async (prefix: string) => (await bucket().getFiles({ prefix }))[0].map((f) => f.name);
const cancelOn = (orgId: string, day: string) => storeOperatorAction(orgId, { kind: "cancelSubscription" }, { uid: "op-uid", email: "joe@sasimem.example" }, new Date(`${day}T00:00:00Z`));

// The single operator of PLAN-SUBSCRIBERS is now the console's Owner (PLAN-ADMIN-DASHBOARD §4).
beforeAll(async () => { await asStaff("op-uid", "owner"); });

describe("export everything (PLAN-SUBSCRIBERS §11)", () => {
  test("contains every CSV and every invoice PDF of the org, and nothing of another org", async () => {
    const a = await aSentMonth({ tenancies: [{ id: "k1", tenantName: "Peter Kila" }, { id: "k2", tenantName: "Ann Vele" }] });
    await aSentMonth({ tenancies: [{ id: "k1", tenantName: "Boni Toua" }] });
    const invoices = await invoicesOf(a.orgId);
    const paid = invoices[0];
    if (paid === undefined) throw new Error("no invoices");
    await setPaid(a.orgId, paid.id, { actor: a.uid, now: T0, note: "BSP transfer" });
    const s = setUp();

    const got = await s.exportAs(a.uid, a.orgId);
    expect(got.filename).toBe("sasimem-wari-holdings-2026-10-05.zip");
    expect(got.url).toMatch(/^https:\/\/sasimem\.example\/x\/[A-Za-z0-9_-]{20,}$/);
    const res = await s.fetch(got.url);
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${got.filename}"`, "Cache-Control": "private, no-store" });
    const zip = unzip(res.body as Buffer);
    expect([...zip.keys()].sort()).toEqual([
      "charges.csv", "invoices.csv", "invoices/INV-0001.pdf", "invoices/INV-0002.pdf", "payments.csv", "properties.csv", "tenancies.csv", "tenants.csv",
    ]);
    for (const d of invoices) {
      const [pdf] = await bucket().file(String(d.get("pdfPath"))).download();
      expect(zip.get(`invoices/${String(d.get("number"))}.pdf`)?.equals(pdf)).toBe(true);
    }
    const csv = (name: string) => zip.get(name)?.toString("utf8") ?? "";
    const all = ["invoices.csv", "payments.csv", "properties.csv", "tenancies.csv", "tenants.csv"].map(csv).join("\n");
    for (const name of ["Peter Kila", "Ann Vele"]) expect(all).toContain(name);
    expect(all).not.toContain("Boni Toua");
    expect(csv("invoices.csv").split("\r\n")).toHaveLength(4); // header, two invoices, the final newline
    expect(csv("payments.csv")).toContain(`${String(paid.get("number"))},${String(paid.get("snapshot.tenantName"))},`);
    expect(csv("payments.csv")).toContain(",2026-10-05,BSP transfer");
  }, SLOW);

  test("the link is short-lived, replaced by the next export, and only for that org's owner", async () => {
    const a = await aSentMonth();
    const stranger = await anOrgWith();
    const s = setUp();
    await expect(s.exportAs(stranger.uid, a.orgId)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(s.exportAs(null, a.orgId)).rejects.toMatchObject({ code: "unauthenticated" });

    const got = await s.exportAs(a.uid, a.orgId);
    expect(got.expiresAt).toBe(new Date(T0.getTime() + 60 * MIN).toISOString());
    s.at(new Date(T0.getTime() + 59 * MIN));
    expect((await s.fetch(got.url)).status).toBe(200);
    s.at(new Date(T0.getTime() + 61 * MIN));
    const late = await s.fetch(got.url);
    expect(late.status).toBe(410);
    expect(late.body).toContain("Make a new export");
    expect((await s.fetch("https://sasimem.example/x/nothing-like-a-real-token-here")).status).toBe(404);
    expect((await s.fetch("https://sasimem.example/x/x")).status).toBe(404);

    s.at(T0);
    const older = await s.exportAs(a.uid, a.orgId);
    const newer = await s.exportAs(a.uid, a.orgId);
    expect((await s.fetch(older.url)).status).toBe(404);
    expect((await s.fetch(newer.url)).status).toBe(200);
    expect(await files(`exports/${a.orgId}/`)).toHaveLength(1); // server-only: storage.rules opens nothing under exports/
  }, SLOW);

  test("works while cancelled, so the landlord can take their records", async () => {
    const a = await aSentMonth();
    await cancelOn(a.orgId, "2026-10-04");
    const s = setUp();
    const got = await s.exportAs(a.uid, a.orgId);
    expect((await s.fetch(got.url)).status).toBe(200);
  }, SLOW);
});

describe("cancel and reinstate (PLAN-SUBSCRIBERS §7, §11)", () => {
  test("the landlord's cancel sets purgeAfter 90 days on and emails the export link once; runs already approved still send", async () => {
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1", tenantName: "Peter Kila", tenantEmail: "peter@tenant.example" }] });
    const LEAD = new Date("2026-09-28T00:00:00Z");
    await draftRun(orgId, OCT, LEAD);
    await approveRun(orgId, OCT, { actor: uid, now: LEAD });
    await renderMissingPdfs(orgId, OCT);
    const stranger = await anOrgWith();
    const s = setUp(new Date("2026-09-29T00:00:00Z"));

    await expect(s.cancelAs(stranger.uid, orgId)).rejects.toMatchObject({ code: "permission-denied" });
    expect(await s.cancelAs(uid, orgId)).toEqual({ status: "cancelled", purgeAfter: "2026-12-28" });
    expect(await subOf(orgId)).toMatchObject({ status: "cancelled", cancelledOn: "2026-09-29", purgeAfter: "2026-12-28" });
    await expect(s.cancelAs(uid, orgId)).rejects.toMatchObject({ code: "failed-precondition", message: "Already cancelled." });
    expect(await eventsOf(orgId)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "cancelSubscription", actor: uid, actorEmail: LANDLORD })]));

    await s.subscriptionTick(at6("2026-09-30"), [orgId]); // the morning's catch-up finds it sent
    const mails = s.mailer.to(LANDLORD);
    expect(mails.map((m) => m.subject)).toEqual(["Your Sasimem subscription is cancelled"]);
    expect(mails[0]?.text.replace(/\s+/g, " ")).toContain("until 28 December 2026, and then deleted");
    expect(mails[0]?.text).toContain("https://sasimem.example/settings/billing#export");

    // October was approved before the cancel: it still goes on 1 October. November is not drafted.
    const tickDeps = { ...s.deps };
    s.at(new Date("2026-09-30T22:00:00Z"));
    await runTick(tickDeps, { orgIds: [orgId] });
    expect(s.mailer.to("peter@tenant.example")).toHaveLength(1);
    s.at(new Date("2026-10-28T22:00:00Z"));
    expect(await runTick(tickDeps, { orgIds: [orgId] })).toMatchObject({ skipped: 1 });
    expect((await adminDb().doc(`orgs/${orgId}/runs/${NOV}`).get()).exists).toBe(false);
  }, SLOW);

  test("an operator's cancel emails the landlord too, and reinstate before purgeAfter gives back the status it had", async () => {
    const { orgId } = await anOrgWith();
    const s = setUp(new Date("2026-10-01T00:00:00Z"));
    expect(await s.operator(orgId, { kind: "cancelSubscription" })).toMatchObject({ status: "cancelled" });
    expect(s.mailer.to(LANDLORD).map((m) => m.subject)).toEqual(["Your Sasimem subscription is cancelled"]);

    s.at(new Date("2026-10-10T00:00:00Z"));
    expect(await s.operator(orgId, { kind: "reinstate" })).toMatchObject({ status: "trial" });
    expect(await subOf(orgId)).toMatchObject({ status: "trial", trialEndsOn: "2026-10-30", cancelledOn: null, purgeAfter: null });

    const paid = await anOrgWith();
    await sub(paid.orgId).update({ status: "active", trialEndsOn: null, paidThrough: "2027-09-30" });
    await s.operator(paid.orgId, { kind: "cancelSubscription" });
    expect(await s.operator(paid.orgId, { kind: "reinstate" })).toMatchObject({ status: "active" });
  });

  test("from purgeAfter on, reinstate is refused", async () => {
    const { orgId } = await anOrgWith();
    await cancelOn(orgId, "2026-10-01");
    const s = setUp(new Date("2026-12-30T00:00:00Z"));
    await expect(s.operator(orgId, { kind: "reinstate" })).rejects.toMatchObject({ code: "failed-precondition", message: "This subscription has been purged." });
  });
});

describe("purge (PLAN-SUBSCRIBERS §10 step 4, §11)", () => {
  test("copies issued invoices and PDFs to the retention bucket before deleting anything, and stops if the copy fails", async () => {
    const { uid, orgId } = await aSentMonth();
    await cancelOn(orgId, "2026-10-06"); // purge on 4 January 2027
    const s = setUp();
    const refusing = { name: "refusing", file: () => ({ save: async () => { throw new Error("retention bucket refused"); } }) } as never;
    await expect(s.subscriptionTick(at6("2027-01-04"), [orgId], { retention: () => refusing })).rejects.toThrow("retention bucket refused");

    expect((await adminDb().doc(`orgs/${orgId}`).get()).exists).toBe(true);
    expect(await invoicesOf(orgId)).toHaveLength(1);
    expect((await sub(orgId).get()).exists).toBe(true);
    expect((await getAuth().getUser(uid)).uid).toBe(uid);
    expect(await files(`invoices/${orgId}/`)).toHaveLength(1);
  }, SLOW);

  test("deletes the org tree, the subscription and the user's account; the retention copy remains", async () => {
    const { uid, orgId } = await aSentMonth();
    await bucket().file(`logos/${orgId}/logo.png`).save(Buffer.from("png"), { contentType: "image/png" });
    const [invoice] = await invoicesOf(orgId);
    if (invoice === undefined) throw new Error("no invoice");
    const [pdf] = await bucket().file(String(invoice.get("pdfPath"))).download();
    await cancelOn(orgId, "2026-10-07"); // purge on 5 January 2027
    const s = setUp();
    await s.exportAs(uid, orgId);

    expect(await s.subscriptionTick(at6("2027-01-04"), [orgId])).toMatchObject({ purged: 0 });
    expect((await adminDb().doc(`orgs/${orgId}`).get()).exists).toBe(true);

    expect(await s.subscriptionTick(at6("2027-01-05"), [orgId])).toMatchObject({ purged: 1 });
    expect((await adminDb().doc(`orgs/${orgId}`).get()).exists).toBe(false);
    expect(await invoicesOf(orgId)).toEqual([]);
    expect((await adminDb().collection(`orgs/${orgId}/members`).get()).empty).toBe(true);
    expect((await sub(orgId).get()).exists).toBe(false);
    expect((await sub(orgId).collection("notices").get()).empty).toBe(true);
    expect((await adminDb().doc(`users/${uid}`).get()).exists).toBe(false);
    await expect(getAuth().getUser(uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    expect((await adminDb().collection("approvalTokens").where("orgId", "==", orgId).get()).empty).toBe(true);
    expect((await adminDb().collection("exportLinks").where("orgId", "==", orgId).get()).empty).toBe(true);
    for (const prefix of ["invoices", "logos", "exports"]) expect(await files(`${prefix}/${orgId}/`)).toEqual([]);

    const kept = retentionBucket(RETENTION);
    const [copy] = await kept.file(`orgs/${orgId}/invoices/${invoice.id}.pdf`).download();
    expect(copy.equals(pdf)).toBe(true);
    const [json] = await kept.file(`orgs/${orgId}/invoices/${invoice.id}.json`).download();
    expect(JSON.parse(json.toString("utf8"))).toMatchObject({ number: invoice.get("number"), totalToea: invoice.get("totalToea") });
    const [org] = await kept.file(`orgs/${orgId}/org.json`).download();
    expect(JSON.parse(org.toString("utf8"))).toMatchObject({ name: "Wari Holdings", email: LANDLORD });

    expect(await eventsOf(orgId)).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "purged", actor: "subscription-tick", detail: expect.objectContaining({ name: "Wari Holdings", invoices: 1, pdfs: 1, retentionBucket: RETENTION }),
    })]));
    expect(s.mailer.to("ops@sasimem.example").at(-1)?.text.replace(/\s+/g, " ")).toContain("Purged today (1): Wari Holdings: 1 issued invoice kept in sasimem-test-retention");

    // Run again: nothing left to do, nothing fails.
    expect(await s.subscriptionTick(at6("2027-01-06"), [orgId])).toMatchObject({ checked: 1, purged: 0 });
  }, SLOW);
});
