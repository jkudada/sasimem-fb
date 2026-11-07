/**
 * After sending, the approval link becomes the month's tracking page, and /owed shows
 * everything unpaid (plan §6.1). Both server-rendered, no JavaScript needed.
 */
import { parsePeriod } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { type PageDeps, handleApproval } from "../src/http/approvalPage.js";
import { makeNonce } from "../src/links.js";
import { approveRun } from "../src/store/approval.js";
import { renderMissingPdfs } from "../src/store/pdfs.js";
import { lookupToken } from "../src/store/tokens.js";
import { runTick } from "../src/tick.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { anOrgWith, type TenancySeed } from "./harness/seed.js";

const LEAD = new Date("2026-09-27T22:00:00Z");
const SEND = new Date("2026-09-30T22:00:00Z");
const DAY = 86_400_000;
const key = "tracking-key";

async function sentMonth(tenancies: TenancySeed[] = [{ id: "k1", tenantName: "Peter Kila", rent: 120_000 }, { id: "k2", tenantName: "Mary Wari", rent: 90_000 }]) {
  const { orgId } = await anOrgWith({ tenancies });
  const mailer = new FakeMailer();
  const t = tokens();
  let now = LEAD;
  const deps: PageDeps = { now: () => now, mailer, newToken: t.next, appUrl: () => "https://sasimem.example", signingKey: () => key };
  await runTick(deps, { orgIds: [orgId] });
  await approveRun(orgId, parsePeriod("2026-10"), { actor: "uid", now });
  await renderMissingPdfs(orgId, parsePeriod("2026-10"));
  now = SEND;
  await runTick(deps, { orgIds: [orgId] });
  const tracking = t.nth(2); // the digest had the first
  now = new Date("2026-10-12T01:00:00Z"); // 12 October: due 8 October, so overdue
  return {
    orgId, mailer, tracking, tok: t.nth, deps,
    at: (when: Date) => (now = when),
    get: (path: string) => handleApproval({ method: "GET", path, form: {} }, deps),
    post: (path: string, form: Record<string, string>) => handleApproval({ method: "POST", path, form }, deps),
    nonce: (token = tracking) => makeNonce(key, token, now),
  };
}
const invoice = (orgId: string, id: string) => adminDb().doc(`orgs/${orgId}/invoices/${id}`).get();

describe("the tracking link", () => {
  test("is minted at release for 60 days, and the dispatch notice carries it and the owed link", async () => {
    const m = await sentMonth();
    const notice = m.mailer.to("mary@wari.example").find((x) => x.subject.startsWith("Sent"));
    expect(notice?.text).toContain(`https://sasimem.example/a/${m.tracking}\n`);
    expect(notice?.text).toContain(`https://sasimem.example/a/${m.tracking}/owed`);
    expect((await lookupToken(m.tracking, new Date(SEND.getTime() + 59 * DAY))).state).toBe("live");
    expect((await lookupToken(m.tracking, new Date(SEND.getTime() + 60 * DAY))).state).toBe("dead");
  });
});

describe("the tracking page (a sent month's link)", () => {
  test("lists each invoice - number, tenant, total, due date, where it stands - and what is still unpaid", async () => {
    const m = await sentMonth();
    const res = await m.get(`/a/${m.tracking}`);
    expect(res.status).toBe(200);
    for (const text of ["INV-0001", "Mary Wari", "INV-0002", "Peter Kila", "K1,200.00", "due 8 October 2026", "Overdue", "0 of 2 paid", "K2,100.00 still unpaid"]) expect(res.body).toContain(text);
    expect(res.body).toContain(`href="/a/${m.tracking}/owed"`);
    expect(res.body).not.toContain("<script src");
  });

  test("a paid tick marks it paid, emails nobody, and the page says so; it can be undone", async () => {
    const m = await sentMonth();
    const before = m.mailer.sent.length;
    const res = await m.post(`/a/${m.tracking}/paid`, { nonce: m.nonce(), invoice: "k1_2026-10", paid: "1" });
    expect(res.status).toBe(303);
    expect(res.headers["Location"]).toBe(`/a/${m.tracking}`);
    expect((await invoice(m.orgId, "k1_2026-10")).data()).toMatchObject({ status: "paid", paidAt: Timestamp.fromDate(new Date("2026-10-12T01:00:00Z")) });
    expect((await m.get(`/a/${m.tracking}`)).body).toContain("1 of 2 paid");
    await m.post(`/a/${m.tracking}/paid`, { nonce: m.nonce(), invoice: "k1_2026-10", paid: "0" });
    expect((await invoice(m.orgId, "k1_2026-10")).get("status")).toBe("sent");
    expect(m.mailer.sent.length).toBe(before);
    const events = (await adminDb().collection(`orgs/${m.orgId}/events`).where("actor", "==", "approval-link").get()).docs.map((d) => d.get("kind"));
    expect(events.sort()).toEqual(["invoicePaid", "invoiceUnpaid"]);
  });

  test("a paid tick without a valid nonce, or for another org's invoice, changes nothing", async () => {
    const m = await sentMonth();
    expect((await m.post(`/a/${m.tracking}/paid`, { invoice: "k1_2026-10", paid: "1" })).status).toBe(400);
    const other = await sentMonth();
    const res = await m.post(`/a/${m.tracking}/paid`, { nonce: m.nonce(), invoice: "../../orgs/x", paid: "1" });
    expect(res.status).toBe(400);
    expect((await invoice(other.orgId, "k1_2026-10")).get("status")).toBe("sent");
  });

  test("the digest's link, while it lives, opens the tracking page too", async () => {
    const m = await sentMonth();
    m.at(new Date("2026-10-02T00:00:00Z"));
    expect((await m.get(`/a/${m.tok(1)}`)).body).toContain("0 of 2 paid");
  });

  test("with 20 tenants it stays under 30 KB, with the usual headers", async () => {
    const m = await sentMonth(Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, tenantName: `Tenant number ${i} with a long name`, rent: 123_456 })));
    const res = await m.get(`/a/${m.tracking}`);
    expect(Buffer.byteLength(res.body)).toBeLessThanOrEqual(30 * 1024);
    expect(res.headers).toMatchObject({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
  });
});

describe("the owed page", () => {
  test("lists everything unpaid across months, grouped by tenant, oldest debt first, with the total", async () => {
    const m = await sentMonth();
    await adminDb().doc(`orgs/${m.orgId}/invoices/k2_2026-10`).update({ dueDate: "2026-10-05" }); // Mary has owed longer
    const res = await m.get(`/a/${m.tracking}/owed`);
    expect(res.status).toBe(200);
    expect(res.body.indexOf("Mary Wari")).toBeLessThan(res.body.indexOf("Peter Kila"));
    expect(res.body).toContain("K2,100.00 owed");
    expect(res.body).toContain("October 2026");
  });

  test("a tick from the owed page comes back to it, and paid invoices drop off", async () => {
    const m = await sentMonth();
    const res = await m.post(`/a/${m.tracking}/paid`, { nonce: m.nonce(), invoice: "k1_2026-10", paid: "1", back: "owed" });
    expect(res.headers["Location"]).toBe(`/a/${m.tracking}/owed`);
    expect((await m.get(`/a/${m.tracking}/owed`)).body).not.toContain("Peter Kila");
  });

  test("from a dead link it shows nothing owed, only the offer of a fresh link", async () => {
    const m = await sentMonth();
    m.at(new Date(SEND.getTime() + 61 * DAY));
    const res = await m.get(`/a/${m.tracking}/owed`);
    expect(res.status).toBe(410);
    expect(res.body).not.toContain("Peter Kila");
    expect(res.body).toContain("Email me a new link");
  });

  test("'email me a new link' for a sent month sends a fresh tracking link to the org's address", async () => {
    const m = await sentMonth();
    m.at(new Date(SEND.getTime() + 61 * DAY));
    const res = await m.post(`/a/${m.tracking}/fresh`, { nonce: m.nonce() });
    expect(res.status).toBe(200);
    const fresh = m.mailer.sent.at(-1);
    expect(fresh?.to).toBe("mary@wari.example");
    expect(fresh?.subject).toBe("Your new link for October 2026");
    expect((await m.get(`/a/${m.tok(3)}`)).body).toContain("of 2 paid");
  });
});
