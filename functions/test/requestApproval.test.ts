import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeDraftNow, makeReissueApproval } from "../src/callables/runs.js";
import { tokenId } from "../src/links.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { anOrgWith } from "./harness/seed.js";

const now = new Date("2026-09-28T00:00:00Z"); // 28 September, Port Moresby
const week = new Date(now.getTime() + 7 * 86_400_000);
const appUrl = "https://sasimem.example";

function setup() {
  const mailer = new FakeMailer();
  const t = tokens();
  const deps = { now: () => now, mailer, newToken: t.next, appUrl: () => appUrl };
  return { mailer, tok: t.nth, draftNow: makeDraftNow(deps), reissue: makeReissueApproval(deps) };
}

describe("draftNow: generate this month's invoices now (plan §6.2)", () => {
  test("drafts the month, asks for approval, keeps only the token's hash, and emails the digest with the link to the org", async () => {
    const { mailer, tok, draftNow } = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1", rent: 120_000 }, { id: "k2", rent: 90_000 }] });
    expect(await draftNow.run(request(uid, { orgId, period: "2026-10" }))).toEqual({ status: "awaitingApproval", message: "Sent you the approval link for October 2026." });

    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).data()).toMatchObject({
      status: "awaitingApproval", approvalTokenId: tokenId(tok(1)),
      approvalSentAt: Timestamp.fromDate(now), approvalExpiresAt: Timestamp.fromDate(week),
    });
    expect((await adminDb().doc(`approvalTokens/${tokenId(tok(1))}`).get()).data()).toEqual({
      orgId, period: "2026-10", expiresAt: Timestamp.fromDate(week), replacedAt: null,
    });
    expect((await adminDb().doc(`approvalTokens/${tok(1)}`).get()).exists).toBe(false); // never the raw token
    const [mail] = mailer.to("mary@wari.example");
    expect(mail?.subject).toBe("2 invoices ready for October 2026 - K2,100.00");
    expect(mail?.text).toContain(`${appUrl}/a/${tok(1)}`);
    expect(mailer.sent).toHaveLength(1);
  });

  test("asking again while it waits sends nothing more, and says so", async () => {
    const { mailer, draftNow } = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftNow.run(request(uid, { orgId, period: "2026-10" }));
    expect(await draftNow.run(request(uid, { orgId, period: "2026-10" }))).toEqual({
      status: "awaitingApproval", message: "October 2026 is already waiting for your approval. Check your email for the link.",
    });
    expect(mailer.sent).toHaveLength(1);
  });

  test("a month with no active tenancy says there is nothing to invoice", async () => {
    const { draftNow } = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1", startDate: "2026-11-01" }] });
    await expect(draftNow.run(request(uid, { orgId, period: "2026-10" }))).rejects.toMatchObject({
      code: "failed-precondition", message: "There is nothing to invoice for October 2026: no tenancy is active that month.",
    });
  });

  test("only this month or next can be drafted, in the landlord's time", async () => {
    const { draftNow } = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await expect(draftNow.run(request(uid, { orgId, period: "2027-01" }))).rejects.toMatchObject({ code: "invalid-argument", message: "Choose this month or next." });
    expect((await draftNow.run(request(uid, { orgId, period: "2026-09" }))).status).toBe("awaitingApproval");
  });

  test("refused for someone who is not the organisation's owner", async () => {
    const { draftNow } = setup();
    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await expect(draftNow.run(request(await newUser(), { orgId, period: "2026-10" }))).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("reissueApproval: a fresh link (plan §6.2)", () => {
  test("replaces the token, so the old link stops working, and emails the org's own address", async () => {
    const { mailer, tok, draftNow, reissue } = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await draftNow.run(request(uid, { orgId, period: "2026-10" }));
    await reissue.run(request(uid, { orgId, period: "2026-10" }));
    const [first, second] = [tokenId(tok(1)), tokenId(tok(2))];
    expect((await adminDb().doc(`approvalTokens/${first}`).get()).get("replacedAt")).toEqual(Timestamp.fromDate(now));
    expect((await adminDb().doc(`approvalTokens/${second}`).get()).get("replacedAt")).toBeNull();
    expect((await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).get("approvalTokenId")).toBe(second);
    expect(mailer.sent.map((m) => m.to)).toEqual(["mary@wari.example", "mary@wari.example"]);
    expect(mailer.sent[1]?.text).toContain(`${appUrl}/a/${tok(2)}`);
  });

  test("is refused for a run that has not asked for approval, or is already approved", async () => {
    const { reissue } = setup();
    const { uid, orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    await expect(reissue.run(request(uid, { orgId, period: "2026-10" }))).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
