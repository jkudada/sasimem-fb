/**
 * G2q-c (docs/test-lists/general-g2q.md): revising a sent quote, the invoice drafted on
 * acceptance (D14) in full or as a deposit (D13), the final invoice, quoted vs invoiced,
 * and the one follow-up.
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeOneOffCallables } from "../src/callables/oneoff.js";
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

const SENT = new Date("2026-11-19T01:00:00Z"); // 11:00 on 19 November in Port Moresby
const LATER = new Date("2026-11-20T02:00:00Z");
const key = "quote-convert-key";
const labour = { description: "Labour - rewire kitchen", detail: "Two electricians", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };
const cable = { description: "Cable 2.5mm", detail: "", quantityMilli: 30_000, unit: "m", unitPriceToea: 450, taxCode: "standard" };
const permit = { description: "Council permit", detail: "", quantityMilli: 1000, unit: "", unitPriceToea: 10_000, taxCode: "exempt" };
const ACCEPT = { answer: "accept", name: "Peter Kila", poNumber: "PO-4471", agree: "on" };

/** An org that has sent QUO-0001 (labour and cable, K280.50 with GST) to Kila Trading. */
async function sentQuote(opts: { lines?: readonly object[]; org?: Record<string, unknown> } = {}) {
  const { uid, orgId } = await anOrgWith({ tenancies: [] });
  const org = adminDb().doc(`orgs/${orgId}`);
  await org.update({ features: { rentals: true, repeating: true, oneOff: true, quotes: true }, gstRegistered: true, gstNumber: "500012345", ...opts.org });
  await org.collection("tenants").doc("c1").set({ name: "Kila Trading", email: "accounts@kila.example", phone: "", ccEmails: [] });
  const draft = org.collection("quoteDrafts").doc();
  await draft.set({ customerId: "c1", lines: opts.lines ?? [labour, cable], notes: "Parts held for 30 days", validDays: null });

  const mailer = new FakeMailer();
  const toks = tokens();
  let now = SENT;
  const deps: QuotePageDeps = { now: () => now, mailer, newToken: toks.next, appUrl: () => "https://sasimem.example", signingKey: () => key };
  const c = makeQuoteCallables(deps);
  const invoices = makeOneOffCallables(deps);
  await c.sendQuote.run(request(uid, { orgId, draftId: draft.id }));
  const id = draft.id;
  const page = (token: string) => ({
    get: () => handleQuote({ method: "GET", path: `/q/${token}`, form: {} }, deps),
    post: (form: Record<string, string>) => handleQuote({ method: "POST", path: `/q/${token}`, form: { nonce: makeNonce(key, token, now), ...form } }, deps),
  });
  return {
    uid, orgId, id, org, mailer, deps, toks, c,
    at: (when: Date) => (now = when),
    link: page(toks.nth(1)),
    page,
    /** Open a revision draft of the quote, as the web's Revise does, with these lines. */
    revise: async (lines: readonly object[] = [labour], who = uid) => {
      await org.collection("quoteDrafts").doc(`${id}_rev`).set({ customerId: "c1", lines, notes: "", validDays: 14, revises: id });
      return c.sendQuote.run(request(who, { orgId, draftId: `${id}_rev` }));
    },
    draftFrom: (kind: string, who = uid) => c.draftFromQuote.run(request(who, { orgId, quoteId: id, kind })),
    send: (draftId: string) => invoices.issueInvoice.run(request(uid, { orgId, draftId })),
    mark: (data: Record<string, string>) => c.markQuote.run(request(uid, { orgId, quoteId: id, ...data })),
    undo: () => c.undoAcceptance.run(request(uid, { orgId, quoteId: id })),
    quote: async () => (await org.collection("quotes").doc(id).get()).data() as StoredQuote,
    draft: async (draftId: string) => (await org.collection("drafts").doc(draftId).get()).data(),
    invoice: async (invoiceId: string) => (await org.collection("invoices").doc(invoiceId).get()).data(),
    events: async (kind: string) => (await org.collection("events").where("kind", "==", kind).get()).docs.map((d) => d.get("note") as string),
  };
}

describe("revising a sent quote", () => {
  test("the same number, revision 2, a new link, PDF and valid-until; rev 1 kept; its link says replaced and refuses an answer", async () => {
    const q = await sentQuote();
    await q.link.get(); // viewed
    q.at(LATER);
    expect(await q.revise()).toMatchObject({ number: "QUO-0001", message: "Sent QUO-0001 rev 2 to Kila Trading." });

    const now = await q.quote();
    expect(now).toMatchObject({ number: "QUO-0001", numberSeq: 1, revision: 2, status: "sent", issueDate: "2026-11-20", validUntil: "2026-12-04", totalToea: 13_200 });
    expect(now.pdfPath).toMatch(/-r2\.pdf$/);
    expect(now.viewedAt).toBeUndefined();
    const before = (await q.org.collection("quotes").doc(q.id).collection("revisions").doc("1").get()).data();
    expect(before).toMatchObject({ revision: 1, status: "viewed", totalToea: 28_050, supersededAt: Timestamp.fromDate(LATER) });
    expect((await q.org.collection("quoteDrafts").doc(`${q.id}_rev`).get()).exists).toBe(false);
    expect(await q.events("quoteRevised")).toEqual(["QUO-0001 rev 2, Kila Trading"]);

    const mail = q.mailer.sent.at(-1);
    expect(mail?.subject).toBe("Quote QUO-0001 rev 2 (replaces rev 1) from Wari Holdings - K132.00, valid until 4 December 2026");
    expect(mail?.text).toContain("It replaces the earlier version, whose link no longer works.");

    const old = await q.link.get();
    expect(old.status).toBe(410);
    expect(String(old.body)).toContain("This quote was replaced");
    expect((await q.link.post(ACCEPT)).status).toBe(410);
    const fresh = q.page(q.toks.nth(2));
    expect(String((await fresh.get()).body)).toContain("Quote QUO-0001 rev 2");
    expect((await fresh.post(ACCEPT)).status).toBe(303);
    expect(await q.quote()).toMatchObject({ status: "accepted", acceptance: { revision: 2, totalToea: 13_200 } });
  });

  test("a declined quote can be revised; an accepted one cannot", async () => {
    const declined = await sentQuote();
    await declined.link.post({ answer: "decline", reason: "Too dear" });
    await declined.revise();
    expect(await declined.quote()).toMatchObject({ revision: 2, status: "sent" });
    expect((await declined.quote()).decline).toBeUndefined();

    const accepted = await sentQuote();
    await accepted.link.post(ACCEPT);
    await expect(accepted.revise()).rejects.toMatchObject({ code: "invalid-argument", message: "QUO-0001 was accepted, so it cannot be revised. Undo the acceptance first." });
    expect((await accepted.quote()).revision).toBe(1);
  });

  test("refused for a quote of another org, a quote that is gone, or a non-owner", async () => {
    const mine = await sentQuote();
    const theirs = await sentQuote();
    await mine.org.collection("quoteDrafts").doc("x_rev").set({ customerId: "c1", lines: [labour], notes: "", validDays: null, revises: theirs.id });
    await expect(mine.c.sendQuote.run(request(mine.uid, { orgId: mine.orgId, draftId: "x_rev" }))).rejects.toMatchObject({ message: "The quote this revises is not there any more." });
    expect((await theirs.quote()).revision).toBe(1);
    await expect(mine.revise([labour], await newUser())).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("a revision and an acceptance at once: exactly one wins", async () => {
    const q = await sentQuote();
    await q.org.collection("quoteDrafts").doc(`${q.id}_rev`).set({ customerId: "c1", lines: [labour], notes: "", validDays: 14, revises: q.id });
    const [revised, answered] = await Promise.allSettled([
      q.c.sendQuote.run(request(q.uid, { orgId: q.orgId, draftId: `${q.id}_rev` })),
      q.link.post(ACCEPT),
    ]);
    const now = await q.quote();
    if (now.revision === 2) {
      expect(revised.status).toBe("fulfilled");
      expect(now.status).toBe("sent");
      expect(await q.events("quoteAccepted")).toEqual([]);
    } else {
      expect(revised.status).toBe("rejected");
      expect(now.status).toBe("accepted");
      expect(answered).toMatchObject({ status: "fulfilled", value: { status: 303 } });
    }
  }, RACE_TIMEOUT_MS);
});

describe("the invoice drafted on acceptance (D14)", () => {
  test("accepting on the link drafts it in full, once, with the lines, PO number and a note of the acceptance", async () => {
    const q = await sentQuote();
    q.at(LATER);
    await Promise.all([q.link.post(ACCEPT), q.link.post(ACCEPT)]);
    const drafts = await q.org.collection("drafts").get();
    expect(drafts.docs.map((d) => d.id)).toEqual([`${q.id}_r1_full`]);
    expect(drafts.docs[0]?.data()).toEqual({
      customerId: "c1", lines: [labour, cable], poNumber: "PO-4471", dueDays: null,
      notes: "Quote QUO-0001, accepted by Peter Kila on 20 November 2026.\nParts held for 30 days",
    });
    expect(q.mailer.sent.at(-1)?.text).toContain("Its invoice is drafted for you to check and send.");
  }, RACE_TIMEOUT_MS);

  test("recording an acceptance by hand drafts it too", async () => {
    const q = await sentQuote();
    expect(await q.mark({ answer: "accept", name: "Peter Kila", poNumber: "" })).toEqual({ message: "Recorded: QUO-0001 accepted by Peter Kila. Its invoice is drafted for you to check and send." });
    expect(await q.draft(`${q.id}_r1_full`)).toMatchObject({ poNumber: "", lines: [labour, cable] });
  });

  test("with a deposit setting that applies, it is a deposit: one line per tax code", async () => {
    const q = await sentQuote({ lines: [labour, permit], org: { depositPercent: 30, depositOverToea: 10_000 } });
    await q.link.post(ACCEPT);
    expect(await q.draft(`${q.id}_r1_full`)).toBeUndefined();
    expect((await q.draft(`${q.id}_r1_deposit`))?.lines).toEqual([
      { description: "Deposit for QUO-0001", detail: "30% of the standard-rated work", quantityMilli: 1000, unit: "", unitPriceToea: 3_600, taxCode: "standard" },
      { description: "Deposit for QUO-0001", detail: "30% of the GST-exempt work", quantityMilli: 1000, unit: "", unitPriceToea: 3_000, taxCode: "exempt" },
    ]);
  });

  test("under the deposit amount it is drafted in full", async () => {
    const q = await sentQuote({ org: { depositPercent: 30, depositOverToea: 100_000 } });
    await q.link.post(ACCEPT);
    expect(await q.draft(`${q.id}_r1_full`)).toBeDefined();
  });

  test("the owner switches between deposit and in full while nothing is sent; refused after", async () => {
    const q = await sentQuote();
    await q.link.post(ACCEPT);
    expect(await q.draftFrom("deposit")).toEqual({ draftId: `${q.id}_r1_deposit`, message: "The invoice for QUO-0001 is drafted as a deposit." });
    expect(await q.draft(`${q.id}_r1_full`)).toBeUndefined();
    expect((await q.draft(`${q.id}_r1_deposit`))?.lines).toHaveLength(1); // half, the default share
    expect(await q.draftFrom("full")).toEqual({ draftId: `${q.id}_r1_full`, message: "The invoice for QUO-0001 is drafted in full." });
    expect(await q.draft(`${q.id}_r1_deposit`)).toBeUndefined();
    await q.draftFrom("deposit");
    await q.send(`${q.id}_r1_deposit`);
    await expect(q.draftFrom("full")).rejects.toMatchObject({ code: "failed-precondition", message: "Part of QUO-0001 is already invoiced, so its draft stays as it is." });
  });

  test("refused for a quote not accepted, a bad kind, or a non-owner", async () => {
    const q = await sentQuote();
    await expect(q.draftFrom("full")).rejects.toMatchObject({ code: "failed-precondition", message: "QUO-0001 is not accepted." });
    await expect(q.draftFrom("half")).rejects.toMatchObject({ code: "invalid-argument" });
    await q.link.post(ACCEPT);
    await expect(q.draftFrom("full", await newUser())).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("the final invoice after the deposit is sent: the quote's lines less the deposit's, made once; the two charge the quote exactly", async () => {
    const q = await sentQuote({ lines: [labour, permit], org: { depositPercent: 30 } });
    await q.link.post(ACCEPT);
    await expect(q.draftFrom("final")).rejects.toMatchObject({ message: "Send the deposit invoice for QUO-0001 first." });
    const deposit = await q.send(`${q.id}_r1_deposit`);
    const final = await q.draftFrom("final");
    expect(final).toEqual({ draftId: `${q.id}_r1_final`, message: "The final invoice for QUO-0001 is drafted." });
    expect(await q.draftFrom("final")).toEqual(final);
    const lines = (await q.draft(`${q.id}_r1_final`))?.lines as { description: string; unitPriceToea: number }[];
    expect(lines.map((l) => [l.description, l.unitPriceToea])).toEqual([
      ["Labour - rewire kitchen", 8_000], ["Council permit", 10_000], [`Less deposit, ${deposit.number}`, -3_600], [`Less deposit, ${deposit.number}`, -3_000],
    ]);
    await q.send(`${q.id}_r1_final`);
    const [d, f] = [await q.invoice(`${q.id}_r1_deposit`), await q.invoice(`${q.id}_r1_final`)];
    expect((d?.gstToea as number) + (f?.gstToea as number)).toBe(1_200);
    expect((d?.totalToea as number) + (f?.totalToea as number)).toBe((await q.quote()).totalToea);
    await expect(q.draftFrom("final")).rejects.toMatchObject({ message: "The final invoice for QUO-0001 was already sent." });
  });
});

describe("quoted vs invoiced", () => {
  test("each invoice sent from the quote counts; Invoiced at the accepted total", async () => {
    const q = await sentQuote({ org: { depositPercent: 30 } });
    await q.link.post(ACCEPT);
    await q.send(`${q.id}_r1_deposit`);
    expect(await q.quote()).toMatchObject({ status: "accepted", invoiceIds: [`${q.id}_r1_deposit`], invoicedToea: 8_415 });
    expect(await q.events("invoiceIssued")).toEqual([expect.stringMatching(/, Kila Trading, from QUO-0001$/)]);
    await q.draftFrom("final");
    await q.send(`${q.id}_r1_final`);
    expect(await q.quote()).toMatchObject({ status: "invoiced", invoicedToea: 28_050 });
  });

  test("more than the accepted total is allowed and kept, to be flagged", async () => {
    const q = await sentQuote();
    await q.link.post(ACCEPT);
    await q.org.collection("drafts").doc(`${q.id}_r1_full`).update({ lines: [labour, cable, { ...permit, taxCode: "standard" }] });
    await q.send(`${q.id}_r1_full`);
    expect(await q.quote()).toMatchObject({ status: "invoiced", invoicedToea: 39_050 });
  });

  test("an invoice not made from a quote leaves quotes alone", async () => {
    const q = await sentQuote();
    await q.link.post(ACCEPT);
    await q.org.collection("drafts").doc("plain").set({ customerId: "c1", lines: [labour], poNumber: "", notes: "", dueDays: null });
    await q.send("plain");
    expect((await q.quote()).invoiceIds).toBeUndefined();
  });
});

describe("undoing an acceptance (G2q-c)", () => {
  test("deletes its unsent invoice draft; refused once an invoice from it is sent", async () => {
    const q = await sentQuote();
    await q.link.post(ACCEPT);
    await q.undo();
    expect(await q.draft(`${q.id}_r1_full`)).toBeUndefined();
    await q.link.post(ACCEPT);
    expect(await q.draft(`${q.id}_r1_full`)).toBeDefined(); // accepted again: drafted again
    await q.send(`${q.id}_r1_full`);
    await expect(q.undo()).rejects.toMatchObject({ code: "failed-precondition", message: "QUO-0001 has been invoiced, so its acceptance stays." });
  });
});

describe("the follow-up", () => {
  const WEEK = new Date("2026-11-26T01:00:00Z"); // 7 days after sending

  test("one reminder after N days, with a fresh link to the same revision; never twice; not for answered quotes", async () => {
    const open = await sentQuote({ org: { quoteFollowUpDays: 7 } });
    const answered = await sentQuote({ org: { quoteFollowUpDays: 7 } });
    await answered.link.post(ACCEPT);
    const tick = (at: Date) => runTick({ ...open.deps, now: () => at }, { orgIds: [open.orgId, answered.orgId] });
    const before = open.mailer.sent.length;

    expect((await tick(new Date("2026-11-26T00:59:59Z"))).followedUp).toBe(0);
    expect((await tick(WEEK)).followedUp).toBe(1);
    expect((await tick(WEEK)).followedUp).toBe(0);
    expect(await open.quote()).toMatchObject({ followedUpAt: Timestamp.fromDate(WEEK) });
    expect(await open.events("quoteFollowedUp")).toEqual(["QUO-0001, Kila Trading"]);

    const mail = open.mailer.sent.slice(before).find((m) => m.subject.startsWith("A reminder"));
    expect(mail).toMatchObject({ to: "accounts@kila.example", subject: "A reminder about quote QUO-0001 from Wari Holdings" });
    const link = /https:\/\/sasimem\.example\/q\/([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1] ?? "";
    expect(link).not.toBe(open.toks.nth(1));
    expect(String((await open.page(link).get()).body)).toContain("Accept quote QUO-0001");
    const logged = await open.org.collection("emails").where("kind", "==", "quoteFollowUp").get();
    expect(logged.size).toBe(1);
  });

  test("none with the setting off, or turned off after sending, or for an expired quote", async () => {
    const off = await sentQuote();
    const turnedOff = await sentQuote({ org: { quoteFollowUpDays: 7 } });
    await turnedOff.org.update({ quoteFollowUpDays: FieldValue.delete() });
    const short = await sentQuote({ org: { quoteFollowUpDays: 60 } });
    const tick = (at: Date) => runTick({ ...off.deps, now: () => at }, { orgIds: [off.orgId, turnedOff.orgId, short.orgId] });
    expect((await tick(new Date("2027-02-01T00:00:00Z"))).followedUp).toBe(0);
    expect((await off.quote()).followUpAt).toBeNull();
  });
});
