/**
 * G2q-b (docs/test-lists/general-g2q.md): the customer's page at /q/{token} - view, PDF,
 * accept, decline - the owner's own record of an answer, undoing an acceptance, and expiry.
 */
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeQuoteCallables } from "../src/callables/quotes.js";
import { handleQuote, type QuotePageDeps } from "../src/http/quotePage.js";
import { makeNonce } from "../src/links.js";
import type { StoredQuote } from "../src/store/quotes.js";
import { runTick } from "../src/tick.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { RACE_TIMEOUT_MS } from "./harness/race.js";
import { anOrgWith } from "./harness/seed.js";

const SENT = new Date("2026-11-19T01:00:00Z"); // 11:00 on 19 November in Port Moresby; valid until 19 December
const LATER = new Date("2026-11-20T02:00:00Z");
const AFTER_DAY = new Date("2026-12-19T14:00:00Z"); // 20 December has begun in Port Moresby
const key = "quote-page-key";
const labour = { description: "Labour - rewire kitchen", detail: "Two electricians", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };
const cable = { description: "Cable 2.5mm", detail: "", quantityMilli: 30_000, unit: "m", unitPriceToea: 450, taxCode: "standard" };

/** An org that has sent QUO-0001 to Kila Trading, and the link the customer got. */
async function sentQuote() {
  const { uid, orgId } = await anOrgWith({ tenancies: [] });
  const org = adminDb().doc(`orgs/${orgId}`);
  await org.update({ features: { rentals: true, repeating: true, oneOff: true, quotes: true }, gstRegistered: true, gstNumber: "500012345", quoteTerms: "Cash on completion." });
  await org.collection("tenants").doc("c1").set({ name: "Kila Trading", email: "accounts@kila.example", phone: "", ccEmails: [] });
  const draft = org.collection("quoteDrafts").doc();
  await draft.set({ customerId: "c1", lines: [labour, cable], notes: "Parts held for 30 days", validDays: null });

  const mailer = new FakeMailer();
  const toks = tokens();
  let now = SENT;
  const deps: QuotePageDeps = { now: () => now, mailer, newToken: toks.next, appUrl: () => "https://sasimem.example", signingKey: () => key };
  const c = makeQuoteCallables(deps);
  await c.sendQuote.run(request(uid, { orgId, draftId: draft.id }));
  const token = toks.nth(1);
  const id = draft.id;
  return {
    uid, orgId, id, token, mailer, deps,
    at: (when: Date) => (now = when),
    get: (path = `/q/${token}`) => handleQuote({ method: "GET", path, form: {} }, deps),
    post: (form: Record<string, string>) => handleQuote({ method: "POST", path: `/q/${token}`, form: { nonce: makeNonce(key, token, now), ...form } }, deps),
    mark: (data: Record<string, string>, who = uid) => c.markQuote.run(request(who, { orgId, quoteId: id, ...data })),
    undo: (who = uid) => c.undoAcceptance.run(request(who, { orgId, quoteId: id })),
    quote: async () => (await org.collection("quotes").doc(id).get()).data() as StoredQuote,
    events: async (kind: string) => (await org.collection("events").where("kind", "==", kind).get()).docs.map((d) => d.get("note") as string),
    /** Emails after the quote itself. */
    toOwner: () => mailer.sent.slice(1),
  };
}

const ACCEPT = { answer: "accept", name: "Peter Kila", poNumber: "PO-4471", agree: "on" };

describe("the customer's page", () => {
  test("shows the business, the quote, its lines and totals, valid until, the terms, the PDF and both answers; no script", async () => {
    const q = await sentQuote();
    const res = await q.get();
    expect(res.status).toBe(200);
    const body = String(res.body);
    for (const s of ["Wari Holdings", "Quote QUO-0001", "For Kila Trading", "Labour - rewire kitchen", "Two electricians · 1.5 hour at K80.00", "K120.00",
      "Cable 2.5mm", "Subtotal", "K255.00", "GST", "K25.50", "K280.50", "Valid until <b>19 December 2026</b>", "Cash on completion.", "Parts held for 30 days",
      `href="/q/${q.token}/pdf"`, "I accept these terms", "Accept quote QUO-0001", "Decline"]) expect(body, s).toContain(s);
    expect(body).not.toContain("<script");
    expect(res.headers).toMatchObject({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
    expect(res.headers["Content-Security-Policy"]).toMatch(/^default-src 'none';/);
    expect(res.headers["Content-Security-Policy"]).not.toContain("unsafe-inline");
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(30 * 1024);
  });

  test("opening it marks the quote viewed, once, with the time; nobody is emailed", async () => {
    const q = await sentQuote();
    q.at(LATER);
    await q.get();
    q.at(AFTER_DAY);
    await q.get();
    expect(await q.quote()).toMatchObject({ status: "viewed", viewedAt: Timestamp.fromDate(LATER) });
    expect(q.toOwner()).toEqual([]);
  });

  test("an unknown link gets a plain page; the PDF is the frozen one", async () => {
    const q = await sentQuote();
    const unknown = await q.get("/q/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(unknown.status).toBe(404);
    expect(String(unknown.body)).toContain("This link does not work");
    const pdf = await q.get(`/q/${q.token}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers).toMatchObject({ "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="QUO-0001.pdf"', "Cache-Control": "private, no-store" });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("accept: recorded with name, PO, time, revision and total; the owner emailed once; the page shows it", async () => {
    const q = await sentQuote();
    q.at(LATER);
    const res = await q.post(ACCEPT);
    expect(res).toMatchObject({ status: 303, headers: { Location: `/q/${q.token}` } });
    expect(await q.quote()).toMatchObject({
      status: "accepted",
      acceptance: { by: "customer", name: "Peter Kila", poNumber: "PO-4471", at: Timestamp.fromDate(LATER), revision: 1, totalToea: 28_050, actor: "quote-link" },
    });
    expect(await q.events("quoteAccepted")).toEqual(["QUO-0001, accepted by Peter Kila, order PO-4471"]);

    expect(q.toOwner()).toHaveLength(1);
    const mail = q.toOwner()[0];
    expect(mail).toMatchObject({ to: "mary@wari.example", subject: "QUO-0001 accepted by Peter Kila" });
    expect(mail?.text).toContain("Peter Kila accepted your quote QUO-0001 to Kila Trading, for K280.50, at 12:00 pm, Friday 20 November 2026.");
    expect(mail?.text).toContain("Order number: PO-4471");
    expect(mail?.text).toContain(`https://sasimem.example/quotes/sent/${q.id}`);

    const page = String((await q.get()).body);
    expect(page).toContain("Accepted by Peter Kila at 12:00 pm, Friday 20 November 2026.");
    expect(page).toContain("Order number PO-4471.");
    expect(page).not.toContain("I accept these terms");
  });

  test("decline: recorded with the reason; the owner emailed once", async () => {
    const q = await sentQuote();
    await q.post({ answer: "decline", reason: "Too dear for us this year" });
    expect(await q.quote()).toMatchObject({ status: "declined", decline: { by: "customer", reason: "Too dear for us this year", revision: 1 } });
    expect(q.toOwner().map((m) => m.subject)).toEqual(["QUO-0001 declined by Kila Trading"]);
    expect(q.toOwner()[0]?.text).toContain("Their reason: Too dear for us this year");
    expect(String((await q.get()).body)).toContain("Your reason: Too dear for us this year");
  });

  test("refused: a missing name or tick (the page says why and keeps what was typed), a bad nonce, a second answer", async () => {
    const q = await sentQuote();
    const missing = await q.post({ answer: "accept", name: "", poNumber: "PO-<1>" });
    expect(missing.status).toBe(422);
    const body = String(missing.body);
    for (const s of ["Type your name.", "Tick &#34;I accept these terms&#34; to accept.", 'value="PO-&#60;1&#62;"', "Nothing was recorded."]) expect(body, s).toContain(s);
    const forged = await handleQuote({ method: "POST", path: `/q/${q.token}`, form: { ...ACCEPT, nonce: "1.forged" } }, q.deps);
    expect(forged.status).toBe(400);
    expect((await q.quote()).status).toBe("sent");

    await q.post(ACCEPT);
    await q.post({ answer: "decline", reason: "Changed our mind" });
    expect(await q.quote()).toMatchObject({ status: "accepted", acceptance: { name: "Peter Kila" } });
    expect(await q.quote()).not.toHaveProperty("decline");
    expect(q.toOwner()).toHaveLength(1);
  });

  test("an expired quote cannot be answered and says who to contact; a link past its life no longer works", async () => {
    const q = await sentQuote();
    q.at(AFTER_DAY);
    const page = String((await q.get()).body);
    expect(page).toContain("QUO-0001 expired on 19 December 2026.");
    expect(page).toContain("mary@wari.example");
    expect(page).not.toContain("I accept these terms");
    await q.post(ACCEPT);
    expect((await q.quote()).status).toBe("viewed");

    q.at(new Date("2027-02-17T14:00:00Z"));
    const dead = await q.get();
    expect(dead.status).toBe(410);
    expect(String(dead.body)).toContain("This link no longer works");
  });

  test("two accepts at once: recorded once, one email", async () => {
    const q = await sentQuote();
    await Promise.all([q.post(ACCEPT), q.post({ ...ACCEPT, name: "Someone Else" })]);
    expect(await q.events("quoteAccepted")).toHaveLength(1);
    expect(q.toOwner()).toHaveLength(1);
  }, RACE_TIMEOUT_MS);
});

describe("the owner records an answer (markQuote)", () => {
  test("accepted by hand with name and PO, as the owner's; or declined; no email either way", async () => {
    const q = await sentQuote();
    expect(await q.mark({ answer: "accept", name: "Peter Kila", poNumber: "4471" })).toEqual({ message: "Recorded: QUO-0001 accepted by Peter Kila. Its invoice is drafted for you to check and send." });
    expect(await q.quote()).toMatchObject({ status: "accepted", acceptance: { by: "owner", name: "Peter Kila", poNumber: "4471", actor: q.uid } });
    expect(await q.events("quoteAccepted")).toEqual(["QUO-0001, accepted by Peter Kila, order 4471 (recorded by the owner)"]);

    const d = await sentQuote();
    expect(await d.mark({ answer: "decline", reason: "Went elsewhere" })).toEqual({ message: "Recorded: QUO-0001 declined." });
    expect(await d.quote()).toMatchObject({ status: "declined", decline: { by: "owner", reason: "Went elsewhere" } });
    expect([...q.toOwner(), ...d.toOwner()]).toEqual([]);
  });

  test("refused: not the owner, no name, a quote already answered", async () => {
    const q = await sentQuote();
    await expect(q.mark({ answer: "accept", name: "Peter Kila" }, await newUser())).rejects.toMatchObject({ code: "permission-denied" });
    await expect(q.mark({ answer: "accept", name: " " })).rejects.toMatchObject({ code: "invalid-argument", message: "Type the name of the person who accepted." });
    await q.post({ answer: "decline", reason: "" });
    await expect(q.mark({ answer: "accept", name: "Peter Kila" })).rejects.toMatchObject({ code: "failed-precondition", message: "QUO-0001 was already declined." });
  });
});

describe("undoing an acceptance", () => {
  test("back to sent, the acceptance gone, an event; the link can accept it again", async () => {
    const q = await sentQuote();
    await q.post(ACCEPT);
    expect(await q.undo()).toEqual({ message: "QUO-0001 is open again. The customer's link can accept it until it expires." });
    expect(await q.quote()).toMatchObject({ status: "sent" });
    expect(await q.quote()).not.toHaveProperty("acceptance");
    expect(await q.events("quoteAcceptanceUndone")).toEqual(["QUO-0001, was accepted by Peter Kila"]);
    q.at(LATER);
    await q.post({ ...ACCEPT, name: "Mary Kila" });
    expect(await q.quote()).toMatchObject({ status: "accepted", acceptance: { name: "Mary Kila" } });
    expect(q.toOwner()).toHaveLength(2);
  });

  test("refused once invoiced, and for a quote not accepted, and for a non-owner", async () => {
    const q = await sentQuote();
    await expect(q.undo()).rejects.toMatchObject({ code: "failed-precondition", message: "QUO-0001 is not accepted." });
    await q.post(ACCEPT);
    await expect(q.undo(await newUser())).rejects.toMatchObject({ code: "permission-denied" });
    await adminDb().doc(`orgs/${q.orgId}/quotes/${q.id}`).update({ invoiceIds: ["inv1"] });
    await expect(q.undo()).rejects.toMatchObject({ code: "failed-precondition", message: "QUO-0001 has been invoiced, so its acceptance stays." });
  });
});

describe("the tick expires quotes", () => {
  test("after their day in the org's time, once; answered ones are left alone", async () => {
    const open = await sentQuote();
    const answered = await sentQuote();
    await answered.post(ACCEPT);
    const tick = (at: Date) => runTick({ ...open.deps, now: () => at }, { orgIds: [open.orgId, answered.orgId] });

    expect((await tick(new Date("2026-12-19T13:00:00Z"))).expired).toBe(0);
    expect((await tick(AFTER_DAY)).expired).toBe(1);
    expect(await open.quote()).toMatchObject({ status: "expired", expiredAt: Timestamp.fromDate(AFTER_DAY) });
    expect(await open.events("quoteExpired")).toEqual(["QUO-0001"]);
    expect((await tick(AFTER_DAY)).expired).toBe(0);
    expect((await answered.quote()).status).toBe("accepted");
    expect(open.toOwner()).toEqual([]);
  });
});
