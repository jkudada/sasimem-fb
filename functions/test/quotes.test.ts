/**
 * G2q-a (docs/test-lists/general-g2q.md): sending a quote. Numbered from its own counter,
 * frozen, PDF "QUOTATION", emailed with the link the customer answers on.
 */
import { createHash } from "node:crypto";
import { DEFAULT_QUOTE_TERMS } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeQuoteCallables } from "../src/callables/quotes.js";
import { renderQuotePdf, type StoredQuote } from "../src/store/quotes.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { pdfText } from "./harness/pdf-text.js";
import { RACE_TIMEOUT_MS } from "./harness/race.js";
import { anOrgWith } from "./harness/seed.js";

const NOW = new Date("2026-11-19T01:00:00Z"); // 11:00 on 19 November in Port Moresby
const labour = { description: "Labour - rewire kitchen", detail: "", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };
const cable = { description: "Cable 2.5mm", detail: "", quantityMilli: 30_000, unit: "m", unitPriceToea: 450, taxCode: "standard" };

async function world(opts: { features?: Record<string, boolean>; draft?: Record<string, unknown>; org?: Record<string, unknown> } = {}) {
  const { uid, orgId } = await anOrgWith({ tenancies: [] });
  const org = adminDb().doc(`orgs/${orgId}`);
  await org.update({
    features: opts.features ?? { rentals: true, repeating: true, oneOff: true, quotes: true },
    gstRegistered: true, gstNumber: "500012345", ...opts.org,
  });
  await org.collection("tenants").doc("c1").set({ name: "Kila Trading", email: "accounts@kila.example", phone: "", ccEmails: ["boss@kila.example"] });
  const draft = org.collection("quoteDrafts").doc();
  await draft.set({ customerId: "c1", lines: [labour, cable], notes: "Parts held for 30 days", validDays: null, ...opts.draft });

  const mailer = new FakeMailer();
  const toks = tokens();
  const deps = { now: () => NOW, mailer, newToken: toks.next, appUrl: () => "https://sasimem.example" };
  const c = makeQuoteCallables(deps);
  return {
    uid, orgId, org, draftId: draft.id, mailer, toks,
    send: (who = uid, id = draft.id) => c.sendQuote.run(request(who, { orgId, draftId: id })),
    quote: async () => (await org.collection("quotes").doc(draft.id).get()).data() as StoredQuote | undefined,
    counter: async () => (await org.collection("private").doc("counter").get()).data() ?? {},
  };
}

describe("sendQuote", () => {
  test("numbered QUO-0001 from its own counter, frozen, sent, with its PDF and hashed link; the draft goes", async () => {
    const w = await world();
    expect(await w.send()).toEqual({ number: "QUO-0001", message: "Sent QUO-0001 to Kila Trading." });

    const q = await w.quote();
    expect(q).toMatchObject({
      customerId: "c1", customerName: "Kila Trading", number: "QUO-0001", numberSeq: 1, revision: 1, status: "sent",
      issueDate: "2026-11-19", validUntil: "2026-12-19", terms: DEFAULT_QUOTE_TERMS,
      subtotalToea: 25_500, gstToea: 2_550, totalToea: 28_050,
      pdfPath: `quotes/${w.orgId}/${w.draftId}-r1.pdf`, sentAt: Timestamp.fromDate(NOW), sentBy: w.uid,
      snapshot: { tenantName: "Kila Trading", tenantEmail: "accounts@kila.example", notes: "Parts held for 30 days", poNumber: "", customer: { ccEmails: ["boss@kila.example"] } },
    });
    expect(await w.counter()).toMatchObject({ nextQuoteNumber: 2, nextInvoiceNumber: 1 }); // invoices' counter untouched

    const hash = createHash("sha256").update(w.toks.nth(1)).digest("hex");
    expect(q?.tokenId).toBe(hash);
    const link = (await adminDb().doc(`quoteTokens/${hash}`).get()).data();
    expect(link).toMatchObject({ orgId: w.orgId, quoteId: w.draftId, revision: 1 });
    // 60 days after the valid-until day ends, in Port Moresby: 18 February 2027 begins at 14:00Z the day before.
    expect((link?.expiresAt as Timestamp).toDate().toISOString()).toBe("2027-02-17T14:00:00.000Z");

    expect((await w.org.collection("quoteDrafts").doc(w.draftId).get()).exists).toBe(false);
    expect((await w.org.collection("invoices").get()).empty).toBe(true);
    expect((await w.org.collection("events").where("kind", "==", "quoteSent").get()).docs.map((d) => d.get("note"))).toEqual(["QUO-0001, Kila Trading"]);
  });

  test("emailed to the customer and copy-to, with the PDF and the link; once", async () => {
    const w = await world();
    await w.send();
    expect(w.mailer.sent).toHaveLength(1);
    const mail = w.mailer.sent[0];
    expect(mail).toMatchObject({
      to: "accounts@kila.example", cc: ["boss@kila.example"],
      subject: "Quote QUO-0001 from Wari Holdings - K280.50, valid until 19 December 2026",
    });
    expect(mail?.text).toContain(`https://sasimem.example/q/${w.toks.nth(1)}`);
    expect(mail?.text).toContain("Parts held for 30 days");
    expect(mail?.attachments?.[0]?.filename).toBe("QUO-0001.pdf");

    expect(await w.send()).toEqual({ number: "QUO-0001", message: "QUO-0001 was already sent." });
    expect(w.mailer.sent).toHaveLength(1);
  });

  test("the quote's own validity, else the org's; the org's terms, or none", async () => {
    const own = await world({ draft: { validDays: 7 }, org: { quoteValidDays: 60, quoteTerms: "Cash on completion." } });
    await own.send();
    expect(await own.quote()).toMatchObject({ validUntil: "2026-11-26", terms: "Cash on completion." });
    const org = await world({ org: { quoteValidDays: 60, quoteTerms: "" } });
    await org.send();
    expect(await org.quote()).toMatchObject({ validUntil: "2027-01-18", terms: "" });
  });

  test("refused: quotes off, one-off invoices off, not the owner, a missing draft", async () => {
    await expect((await world({ features: { rentals: true, repeating: true, oneOff: true } })).send()).rejects.toMatchObject({ code: "failed-precondition" });
    await expect((await world({ features: { rentals: true, repeating: true, quotes: true } })).send()).rejects.toMatchObject({ code: "failed-precondition" });
    const w = await world();
    await expect(w.send(await newUser())).rejects.toMatchObject({ code: "permission-denied" });
    await expect(w.send(w.uid, "nope")).rejects.toMatchObject({ code: "not-found" });
    expect(await w.quote()).toBeUndefined();
  });

  test("refused in core's words: a draft that could not be sent; nothing numbered", async () => {
    const none = await world({ draft: { customerId: "" } });
    await expect(none.send()).rejects.toMatchObject({ code: "invalid-argument", message: "Choose who this quote is for." });
    const empty = await world({ draft: { lines: [] } });
    await expect(empty.send()).rejects.toMatchObject({ code: "invalid-argument", message: "Add at least one line." });
    expect(await empty.counter()).not.toHaveProperty("nextQuoteNumber");
    expect(empty.mailer.sent).toEqual([]);
  });

  test("two sends at once: one quote, one number, one email", async () => {
    const w = await world();
    const replies = await Promise.all([w.send(), w.send()]);
    expect(replies.map((r) => r.number)).toEqual(["QUO-0001", "QUO-0001"]);
    expect(await w.counter()).toMatchObject({ nextQuoteNumber: 2 });
    expect(w.mailer.sent).toHaveLength(1);
  }, RACE_TIMEOUT_MS);

  test("the PDF: QUOTATION, the number, valid until, the lines, GST, total and the terms; nothing about paying", async () => {
    const w = await world({ org: { quoteTerms: "Cash on completion." } });
    await w.send();
    const q = await w.quote() as StoredQuote;
    const text = pdfText(await renderQuotePdf(q, null, { compress: false })).join("\n");
    for (const s of ["QUOTATION", "QUO-0001", "Valid until", "19 December 2026", "Labour - rewire kitchen", "Cable 2.5mm", "GST", "K25.50", "K280.50", "Terms", "Cash on completion."]) {
      expect(text, s).toContain(s);
    }
    for (const s of ["Due", "Pay by bank deposit", "Write this reference", "TAX INVOICE"]) expect(text, s).not.toContain(s);
    expect(pdfText(await renderQuotePdf({ ...q, revision: 2 }, null, { compress: false })).join("\n")).toContain("QUO-0001 rev 2");
  });
});
