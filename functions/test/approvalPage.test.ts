import { describe, expect, test } from "vitest";
import { makeDraftNow } from "../src/callables/runs.js";
import { type PageDeps, handleApproval } from "../src/http/approvalPage.js";
import { makeNonce } from "../src/links.js";
import { request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { anOrgWith, type TenancySeed } from "./harness/seed.js";

const t0 = new Date("2026-09-28T00:00:00Z");
const key = "page-test-key";

/** An org whose October run is waiting for approval, and the link the landlord was sent. */
async function waiting(tenancies: TenancySeed[] = [{ id: "k1", tenantName: "Peter Kila", rent: 120_000 }, { id: "k2", tenantName: "Mary Wari", rent: 90_000 }]) {
  const mailer = new FakeMailer();
  const t = tokens();
  let now = t0;
  const deps: PageDeps = { now: () => now, mailer, newToken: t.next, appUrl: () => "https://sasimem.example", signingKey: () => key };
  const { uid, orgId } = await anOrgWith({ tenancies });
  await makeDraftNow(deps).run(request(uid, { orgId, period: "2026-10" }));
  const token = t.nth(1);
  return {
    orgId, token, mailer, tok: t.nth,
    at: (when: Date) => (now = when),
    get: (path = `/a/${token}`) => handleApproval({ method: "GET", path, form: {} }, deps),
    post: (form: Record<string, string>, path = `/a/${token}`) => handleApproval({ method: "POST", path, form }, deps),
    nonce: () => makeNonce(key, token, now),
  };
}

const run = (orgId: string) => adminDb().doc(`orgs/${orgId}/runs/2026-10`).get();

describe("the approval page (plan §6.1)", () => {
  test("shows one row per invoice - tenant, unit, reference, rent, include box - a total and one Approve button, with no script needed", async () => {
    const page = await waiting();
    const res = await page.get();
    expect(res.status).toBe(200);
    for (const text of ["Peter Kila", "Flat k1", "K1-OCT26", "Mary Wari", "K2,100.00"]) expect(res.body).toContain(text);
    expect(res.body).toContain('name="rent.k1_2026-10" value="K1,200.00"');
    expect(res.body).toMatch(/<input type="checkbox" name="include\.k2_2026-10" checked/);
    expect(res.body.match(/<button/g)).toHaveLength(1);
    expect(res.body).toContain("Approve 2 invoices");
    expect(res.body).not.toMatch(/<script[^>]*src=/); // nothing loaded; the small inline script is optional
  });

  test("every response is uncacheable, unreferred, unindexed, and under a strict content security policy", async () => {
    const page = await waiting();
    for (const res of [await page.get(), await page.get("/a/nonsense-token-that-does-not-exist")]) {
      expect(res.headers).toMatchObject({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
      expect(res.headers["Content-Security-Policy"]).toMatch(/^default-src 'none';/);
      expect(res.headers["Content-Security-Policy"]).not.toContain("unsafe-inline");
    }
  });

  test("with 20 tenants the page stays within 30 KB", async () => {
    const page = await waiting(Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, tenantName: `Tenant number ${i} with a long name`, rent: 123_456 })));
    expect(Buffer.byteLength((await page.get()).body)).toBeLessThanOrEqual(30 * 1024); // 8.8 KB on 2026-11-07
  });

  test("approving applies the rent edits and unticks in one go, then shows when it goes out", async () => {
    const page = await waiting();
    const res = await page.post({ nonce: page.nonce(), "rent.k1_2026-10": "K1,000", "include.k1_2026-10": "on", "rent.k2_2026-10": "K900" });
    expect(res.status).toBe(303);
    expect(res.headers["Location"]).toBe(`/a/${page.token}`);
    expect((await run(page.orgId)).get("status")).toBe("approved");
    expect((await adminDb().doc(`orgs/${page.orgId}/invoices/k1_2026-10`).get()).data()).toMatchObject({ status: "approved", totalToea: 100_000, number: "INV-0001" });
    expect((await adminDb().doc(`orgs/${page.orgId}/invoices/k2_2026-10`).get()).get("status")).toBe("excluded");
    expect((await adminDb().doc(`orgs/${page.orgId}/invoices/k1_2026-10`).get()).get("pdfPath")).not.toBe("");
    const after = await page.get();
    expect(after.body).toContain("Approved - goes out at 8:00 am, Thursday 1 October 2026");
    expect(after.body).not.toContain("<form");
  });

  test("a post without a valid nonce, or with a stale one, changes nothing", async () => {
    const page = await waiting();
    const form = { "rent.k1_2026-10": "K1,200", "include.k1_2026-10": "on", "rent.k2_2026-10": "K900", "include.k2_2026-10": "on" };
    expect((await page.post(form)).status).toBe(400);
    const stale = page.nonce();
    page.at(new Date(t0.getTime() + 31 * 60_000));
    const res = await page.post({ ...form, nonce: stale });
    expect(res.status).toBe(400);
    expect(res.body).toContain("This page was open too long");
    expect((await run(page.orgId)).get("status")).toBe("awaitingApproval");
  });

  test("a bad amount shows the page again with the message, and approves nothing", async () => {
    const page = await waiting();
    const res = await page.post({ nonce: page.nonce(), "rent.k1_2026-10": "twelve hundred", "include.k1_2026-10": "on", "rent.k2_2026-10": "K900", "include.k2_2026-10": "on" });
    expect(res.status).toBe(422);
    expect(res.body).toContain("Enter an amount like K1,200.00.");
    expect(res.body).toContain('value="twelve hundred"'); // what they typed is kept
    expect((await run(page.orgId)).get("status")).toBe("awaitingApproval");
  });

  test("a held run says it will go out within the hour once approved", async () => {
    const page = await waiting();
    await adminDb().doc(`orgs/${page.orgId}/runs/2026-10`).update({ status: "held" });
    expect((await page.get()).body).toContain("This will go out within the hour");
  });
});

describe("I10: an expired or replaced link opens only a request for a new one", () => {
  test("an expired link shows no invoices, and offers a fresh link", async () => {
    const page = await waiting();
    page.at(new Date(t0.getTime() + 8 * 86_400_000));
    const res = await page.get();
    expect(res.status).toBe(410);
    expect(res.body).not.toContain("Peter Kila");
    expect(res.body).toContain("Email me a new link");
  });

  test("a replaced link cannot approve, even with a nonce made for it", async () => {
    const page = await waiting();
    const nonce = page.nonce();
    await adminDb().doc(`orgs/${page.orgId}/runs/2026-10`).get(); // (the run is waiting)
    const { replaceToken } = await import("../src/store/tokens.js");
    await replaceToken(page.orgId, "2026-10" as never, t0, `${page.tok(9)}`);
    const res = await page.post({ nonce, "rent.k1_2026-10": "K1,200", "include.k1_2026-10": "on", "rent.k2_2026-10": "K900", "include.k2_2026-10": "on" });
    expect(res.status).toBe(410);
    expect((await run(page.orgId)).get("status")).toBe("awaitingApproval");
  });

  test("an unknown link says so, and reveals nothing", async () => {
    const page = await waiting();
    const res = await page.get("/a/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("Wari");
  });

  test("'email me a new link' sends it to the org's address on file, never one the visitor gives", async () => {
    const page = await waiting();
    page.at(new Date(t0.getTime() + 8 * 86_400_000));
    const res = await page.post({ nonce: page.nonce(), email: "attacker@evil.example" }, `/a/${page.token}/fresh`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("A new link is on its way to m•••@wari.example");
    expect(page.mailer.sent.map((m) => m.to)).toEqual(["mary@wari.example", "mary@wari.example"]);
    expect(page.mailer.sent[1]?.text).toContain(`/a/${page.tok(2)}`);
  });

  test("asking for new links again and again sends at most one each 10 minutes", async () => {
    const page = await waiting();
    page.at(new Date(t0.getTime() + 8 * 86_400_000));
    await page.post({ nonce: page.nonce() }, `/a/${page.token}/fresh`);
    await page.post({ nonce: page.nonce() }, `/a/${page.token}/fresh`);
    expect(page.mailer.sent).toHaveLength(2); // the digest, then one fresh link
  });
});
