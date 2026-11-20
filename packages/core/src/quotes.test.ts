import { describe, expect, test } from "vitest";
import { customerOf } from "./customers.js";
import { itemLine } from "./lines.js";
import { parseKina } from "./money.js";
import type { CalendarDate } from "./period.js";
import * as quotes from "./quotes.js";
import type { ItemLineInput } from "./types.js";

const labour: ItemLineInput = { description: "Labour", detail: "", quantityMilli: 2000, unit: "hour", unitPriceToea: parseKina("80"), taxCode: "standard" };
const draft: quotes.QuoteDraft = { customerId: "c1", lines: [labour], notes: "", validDays: null, revises: null };
const customer = customerOf({ name: "Kila Trading", email: "accounts@kila.example", phone: "" });
const TODAY = "2026-11-19" as CalendarDate;

describe("a quote draft (G2q-a)", () => {
  test("read defensively: missing fields are empty, a bad line reads as a line with problems", () => {
    expect(quotes.quoteDraftOf({})).toEqual({ customerId: "", lines: [], notes: "", validDays: null, revises: null });
    expect(quotes.quoteDraftOf({ revises: "q1" }).revises).toBe("q1");
    const read = quotes.quoteDraftOf({ customerId: "c1", lines: [null], notes: 3, validDays: 45 });
    expect(read.validDays).toBe(45);
    expect(read.notes).toBe("");
    expect(quotes.quoteProblems(read, customer).lines).toMatch(/^Line 1: /);
  });

  test("a sendable draft has no problems", () => {
    expect(quotes.quoteProblems(draft, customer)).toEqual({});
  });

  test("no customer, no lines, over 30 lines, a total below K0.00, long notes, validity outside 1-365", () => {
    expect(quotes.quoteProblems({ ...draft, customerId: "" }, null).customerId).toBe("Choose who this quote is for.");
    expect(quotes.quoteProblems(draft, null).customerId).toBe("Choose who this quote is for.");
    expect(quotes.quoteProblems({ ...draft, lines: [] }, customer).lines).toBe("Add at least one line.");
    expect(quotes.quoteProblems({ ...draft, lines: Array(31).fill(labour) }, customer).lines).toBe("A quote can have up to 30 lines.");
    expect(quotes.quoteProblems({ ...draft, lines: [{ ...labour, unitPriceToea: parseKina("-1") }] }, customer).lines).toBe("The total is below K0.00.");
    expect(quotes.quoteProblems({ ...draft, notes: "x".repeat(501) }, customer)).toHaveProperty("notes");
    expect(quotes.quoteProblems({ ...draft, validDays: 0 }, customer).validDays).toBe("Choose from 1 to 365 days.");
    expect(quotes.quoteProblems({ ...draft, validDays: 366 }, customer)).toHaveProperty("validDays");
    expect(quotes.quoteProblems({ ...draft, validDays: 7.5 }, customer)).toHaveProperty("validDays");
    expect(quotes.quoteProblems({ ...draft, validDays: 365 }, customer)).toEqual({});
  });
});

test("valid until: the send day plus the quote's days, else the org's, else 30", () => {
  expect(quotes.validUntilOf(TODAY, { quote: 7, org: 60 })).toBe("2026-11-26");
  expect(quotes.validUntilOf(TODAY, { quote: null, org: 60 })).toBe("2027-01-18");
  expect(quotes.validUntilOf(TODAY, { quote: null, org: undefined })).toBe("2026-12-19");
});

describe("the org's quote settings", () => {
  test("terms: the org's own, the default (N11) when never set, none when cleared", () => {
    expect(quotes.quoteTermsOf({ quoteTerms: "  Cash only.  " })).toBe("Cash only.");
    expect(quotes.quoteTermsOf({})).toBe(quotes.DEFAULT_QUOTE_TERMS);
    expect(quotes.DEFAULT_QUOTE_TERMS).toMatch(/^1\. Prices are in kina\./);
    expect(quotes.quoteTermsOf({ quoteTerms: "" })).toBe("");
  });

  test("valid days 1-365, terms up to 2,000 characters", () => {
    expect(quotes.quoteSettingsProblems({ quoteValidDays: 30, quoteTerms: quotes.DEFAULT_QUOTE_TERMS })).toEqual({});
    expect(quotes.quoteSettingsProblems({ quoteValidDays: 0, quoteTerms: "" }).quoteValidDays).toBe("Choose from 1 to 365 days.");
    expect(quotes.quoteSettingsProblems({ quoteValidDays: 30, quoteTerms: "x".repeat(2001) }).quoteTerms).toBe("Keep the terms to 2,000 characters or fewer.");
    expect(quotes.quoteSettingsProblems({ quoteValidDays: 30, quoteTerms: "x".repeat(2000) })).toEqual({});
  });

  test("deposit percent 1-100, deposit over K0.00 or more, follow-up days 1-60; each may be left off", () => {
    const base = { quoteValidDays: 30, quoteTerms: "" };
    expect(quotes.quoteSettingsProblems({ ...base, depositPercent: 30, depositOverToea: parseKina("5000"), quoteFollowUpDays: 7 })).toEqual({});
    expect(quotes.quoteSettingsProblems({ ...base, depositPercent: 100, depositOverToea: 0, quoteFollowUpDays: 60 })).toEqual({});
    expect(quotes.quoteSettingsProblems({ ...base, depositPercent: 0 }).depositPercent).toBe("Choose from 1 to 100 per cent.");
    expect(quotes.quoteSettingsProblems({ ...base, depositPercent: 101 })).toHaveProperty("depositPercent");
    expect(quotes.quoteSettingsProblems({ ...base, depositPercent: 12.5 })).toHaveProperty("depositPercent");
    expect(quotes.quoteSettingsProblems({ ...base, depositOverToea: -1 }).depositOverToea).toBe("Enter an amount of K0.00 or more.");
    expect(quotes.quoteSettingsProblems({ ...base, depositOverToea: 0.5 })).toHaveProperty("depositOverToea");
    expect(quotes.quoteSettingsProblems({ ...base, quoteFollowUpDays: 0 }).quoteFollowUpDays).toBe("Choose from 1 to 60 days.");
    expect(quotes.quoteSettingsProblems({ ...base, quoteFollowUpDays: 61 })).toHaveProperty("quoteFollowUpDays");
  });

  test("a deposit applies only with a percent set, and only over the amount", () => {
    expect(quotes.depositApplies({}, parseKina("99999"))).toBe(false);
    expect(quotes.depositApplies({ depositPercent: 30 }, parseKina("0.01"))).toBe(true);
    expect(quotes.depositApplies({ depositPercent: 30 }, 0 as never)).toBe(false);
    expect(quotes.depositApplies({ depositPercent: 30, depositOverToea: parseKina("5000") }, parseKina("5000"))).toBe(false);
    expect(quotes.depositApplies({ depositPercent: 30, depositOverToea: parseKina("5000") }, parseKina("5000.01"))).toBe(true);
  });
});

describe("sending", () => {
  test("priced as an invoice, GST and all, with valid until and the terms frozen in", () => {
    const q = quotes.issuedQuote({ draft: { ...draft, validDays: 14 }, org: { gstRegistered: true, quoteTerms: "Cash only." }, today: TODAY });
    expect(q).toMatchObject({
      customerId: "c1", issueDate: TODAY, validUntil: "2026-12-03", terms: "Cash only.",
      subtotalToea: parseKina("160"), gstToea: parseKina("16"), totalToea: parseKina("176"),
    });
    expect(q.lines[0]).toMatchObject({ description: "Labour", amountToea: parseKina("160"), gstApplicable: true });
    expect(quotes.issuedQuote({ draft, org: { gstRegistered: false }, today: TODAY })).toMatchObject({ gstToea: 0, totalToea: parseKina("160"), terms: quotes.DEFAULT_QUOTE_TERMS });
  });

  test("its label: the number, and the revision from the second on", () => {
    expect(quotes.quoteLabel("QUO-0012", 1)).toBe("QUO-0012");
    expect(quotes.quoteLabel("QUO-0012", 2)).toBe("QUO-0012 rev 2");
  });
});

describe("answering a quote (G2q-b)", () => {
  const accept = { answer: "accept", name: " Peter Kila ", poNumber: " PO-4471 ", agree: "on" };

  test("accept: a name and the tick; the PO is optional; all trimmed", () => {
    expect(quotes.readQuoteAnswer(accept, "customer")).toEqual({ ok: true, answer: { kind: "accept", name: "Peter Kila", poNumber: "PO-4471" } });
    expect(quotes.readQuoteAnswer({ ...accept, poNumber: undefined }, "customer")).toEqual({ ok: true, answer: { kind: "accept", name: "Peter Kila", poNumber: "" } });
  });

  test("accept refused: no name, no tick, a long name or order number", () => {
    expect(quotes.readQuoteAnswer({ answer: "accept" }, "customer")).toEqual({
      ok: false, problems: { name: "Type your name.", agree: "Tick \"I accept these terms\" to accept." },
    });
    expect(quotes.readQuoteAnswer({ ...accept, name: "x".repeat(101), poNumber: "x".repeat(41) }, "customer")).toEqual({
      ok: false, problems: { name: "Keep the name to 100 characters or fewer.", poNumber: "Keep the order number to 40 characters or fewer." },
    });
  });

  test("the owner records an acceptance without the tick, naming who accepted", () => {
    expect(quotes.readQuoteAnswer({ answer: "accept", name: "Peter Kila" }, "owner")).toEqual({ ok: true, answer: { kind: "accept", name: "Peter Kila", poNumber: "" } });
    expect(quotes.readQuoteAnswer({ answer: "accept" }, "owner")).toEqual({ ok: false, problems: { name: "Type the name of the person who accepted." } });
  });

  test("decline: an optional reason up to 500 characters; anything else is no answer", () => {
    expect(quotes.readQuoteAnswer({ answer: "decline", reason: " Too dear " }, "customer")).toEqual({ ok: true, answer: { kind: "decline", reason: "Too dear" } });
    expect(quotes.readQuoteAnswer({ answer: "decline" }, "owner")).toEqual({ ok: true, answer: { kind: "decline", reason: "" } });
    expect(quotes.readQuoteAnswer({ answer: "decline", reason: "x".repeat(501) }, "customer")).toEqual({ ok: false, problems: { reason: "Keep the reason to 500 characters or fewer." } });
    expect(quotes.readQuoteAnswer({ answer: "maybe" }, "customer")).toEqual({ ok: false, problems: { answer: "Choose to accept or decline." } });
  });

  test("expired once its valid-until day has ended in the org's time", () => {
    const q = { validUntil: "2026-12-19" as CalendarDate };
    const tz = "Pacific/Port_Moresby"; // UTC+10
    expect(quotes.quoteExpired(q, new Date("2026-12-19T13:59:59Z"), tz)).toBe(false);
    expect(quotes.quoteExpired(q, new Date("2026-12-19T14:00:00Z"), tz)).toBe(true);
  });

  test("which answers each status allows: sent and viewed take one until expired; accepted can be undone until invoiced", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const tz = "Pacific/Port_Moresby";
    const q = (status: quotes.QuoteStatus, more: { validUntil?: string; invoiceIds?: string[] } = {}) =>
      quotes.quoteAllows({ status, validUntil: (more.validUntil ?? "2026-12-19") as CalendarDate, ...(more.invoiceIds === undefined ? {} : { invoiceIds: more.invoiceIds }) }, now, tz);
    expect(q("sent")).toEqual({ answer: true, undo: false, revise: true });
    expect(q("viewed")).toEqual({ answer: true, undo: false, revise: true });
    expect(q("viewed", { validUntil: "2026-11-19" })).toEqual({ answer: false, undo: false, revise: true });
    expect(q("accepted")).toEqual({ answer: false, undo: true, revise: false });
    expect(q("accepted", { invoiceIds: ["inv1"] })).toEqual({ answer: false, undo: false, revise: false });
    expect(q("declined")).toEqual({ answer: false, undo: false, revise: true });
    expect(q("expired")).toEqual({ answer: false, undo: false, revise: true });
    expect(q("invoiced", { invoiceIds: ["inv1"] })).toEqual({ answer: false, undo: false, revise: false });
  });

  test("why a quote takes no answer, in words for the customer and the owner", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const tz = "Pacific/Port_Moresby";
    const why = (status: quotes.QuoteStatus, validUntil = "2026-12-19") => quotes.noAnswerReason({ status, validUntil: validUntil as CalendarDate }, "QUO-0001", now, tz);
    expect(why("sent")).toBeNull();
    expect(why("accepted")).toBe("QUO-0001 was already accepted.");
    expect(why("declined")).toBe("QUO-0001 was already declined.");
    expect(why("invoiced")).toBe("QUO-0001 was already accepted.");
    expect(why("expired", "2026-11-18")).toBe("QUO-0001 expired on 18 November 2026.");
    expect(why("sent", "2026-11-19")).toBe("QUO-0001 expired on 19 November 2026.");
  });
});

describe("revising a quote (G2q-c)", () => {
  test("the revision draft has the quote's customer, lines, notes and valid days, and names the quote", () => {
    const sent = quotes.issuedQuote({ draft: { ...draft, validDays: 14 }, org: { gstRegistered: true }, today: TODAY });
    expect(quotes.revisionDraftOf({ ...sent, notes: "Ground floor only" }, "q1")).toEqual({
      customerId: "c1", lines: [labour], notes: "Ground floor only", validDays: 14, revises: "q1",
    });
  });

  test("a revision draft is checked as any quote draft", () => {
    expect(quotes.quoteProblems({ ...draft, revises: "q1" }, customer)).toEqual({});
  });
});

describe("converting to an invoice (G2q-c)", () => {
  const materials: ItemLineInput = { description: "Cable", detail: "", quantityMilli: 3000, unit: "m", unitPriceToea: parseKina("10.01"), taxCode: "standard" };
  const school: ItemLineInput = { description: "School fees", detail: "", quantityMilli: 1000, unit: "", unitPriceToea: parseKina("99.99"), taxCode: "exempt" };
  const quoteOf = (lines: readonly ItemLineInput[], notes = "") => ({
    ...quotes.issuedQuote({ draft: { ...draft, lines }, org: { gstRegistered: true }, today: TODAY }),
    number: "QUO-0012", revision: 2, notes,
    acceptance: { name: "Peter Kila", poNumber: "PO-4471", acceptedOn: "2026-11-20" as CalendarDate },
  });

  test("in full: the customer, the lines, the PO number, and notes saying which quote was accepted by whom", () => {
    const d = quotes.invoiceDraftFromQuote(quoteOf([labour, materials], "Ground floor only"), "full", {});
    expect(d).toEqual({
      customerId: "c1", lines: [labour, materials], poNumber: "PO-4471", dueDays: null,
      notes: "Quote QUO-0012 rev 2, accepted by Peter Kila on 20 November 2026.\nGround floor only",
    });
  });

  test("the notes stay within 500 characters", () => {
    const d = quotes.invoiceDraftFromQuote(quoteOf([labour], "x".repeat(500)), "full", {});
    expect(d.notes.length).toBe(500);
    expect(d.notes.endsWith("…")).toBe(true);
  });

  test("a deposit: one line per tax code, at the share of that code's amount, rounded to the toea", () => {
    const d = quotes.invoiceDraftFromQuote(quoteOf([labour, materials, school]), "deposit", { depositPercent: 30 });
    // standard: 160.00 + 30.03 = 190.03 → 57.009 → 57.01; exempt: 99.99 → 29.997 → 30.00
    expect(d.lines).toEqual([
      { description: "Deposit for QUO-0012 rev 2", detail: "30% of the standard-rated work", quantityMilli: 1000, unit: "", unitPriceToea: parseKina("57.01"), taxCode: "standard" },
      { description: "Deposit for QUO-0012 rev 2", detail: "30% of the GST-exempt work", quantityMilli: 1000, unit: "", unitPriceToea: parseKina("30"), taxCode: "exempt" },
    ]);
    expect(quotes.invoiceDraftFromQuote(quoteOf([labour]), "deposit", { depositPercent: 50 }).lines).toEqual([
      { description: "Deposit for QUO-0012 rev 2", detail: "50% of the quoted work", quantityMilli: 1000, unit: "", unitPriceToea: parseKina("80"), taxCode: "standard" },
    ]);
  });

  test("a deposit the owner picks without a setting is half", () => {
    expect(quotes.invoiceDraftFromQuote(quoteOf([labour]), "deposit", {}).lines[0]?.unitPriceToea).toBe(parseKina("80"));
  });

  test("the final invoice: the quote's lines, then the deposit invoice's lines taken off", () => {
    const deposit = quotes.invoiceDraftFromQuote(quoteOf([labour, school]), "deposit", { depositPercent: 30 });
    const depositLines = deposit.lines.map((l) => itemLine(l, { gstRegistered: true }));
    const final = quotes.finalDraftFromQuote(quoteOf([labour, school]), { number: "INV-0040", lines: depositLines });
    expect(final.lines).toEqual([
      labour, school,
      { description: "Less deposit, INV-0040", detail: "30% of the standard-rated work", quantityMilli: 1000, unit: "", unitPriceToea: parseKina("-48"), taxCode: "standard" },
      { description: "Less deposit, INV-0040", detail: "30% of the GST-exempt work", quantityMilli: 1000, unit: "", unitPriceToea: parseKina("-30"), taxCode: "exempt" },
    ]);
    expect(final).toMatchObject({ customerId: "c1", poNumber: "PO-4471", dueDays: null });
  });

  test("invoice ids name the quote, its revision and the kind, and read back", () => {
    expect(quotes.quoteInvoiceId("q1", 2, "deposit")).toBe("q1_r2_deposit");
    expect(quotes.quoteFromDraftId("q1_r2_deposit")).toEqual({ quoteId: "q1", revision: 2, kind: "deposit" });
    expect(quotes.quoteFromDraftId("ab_c_r12_final")).toEqual({ quoteId: "ab_c", revision: 12, kind: "final" });
    expect(quotes.quoteFromDraftId("q1_r2_other")).toBeNull();
    expect(quotes.quoteFromDraftId("abc123")).toBeNull();
    expect(quotes.quoteFromDraftId("_r1_full")).toBeNull();
  });

  test("quoted vs invoiced: Invoiced at the accepted total, and the amount over it", () => {
    const accepted = { totalToea: parseKina("1000") };
    expect(quotes.quoteInvoiced({ acceptance: accepted, invoicedToea: parseKina("300") })).toEqual({ invoiced: false, overToea: 0 });
    expect(quotes.quoteInvoiced({ acceptance: accepted, invoicedToea: parseKina("1000") })).toEqual({ invoiced: true, overToea: 0 });
    expect(quotes.quoteInvoiced({ acceptance: accepted, invoicedToea: parseKina("2200") })).toEqual({ invoiced: true, overToea: parseKina("1200") });
    expect(quotes.quoteInvoiced({})).toEqual({ invoiced: false, overToea: 0 });
  });
});

describe("the follow-up (G2q-c)", () => {
  const tz = "Pacific/Port_Moresby";
  const at = new Date("2026-11-27T00:00:00Z");
  const q = { status: "sent" as quotes.QuoteStatus, validUntil: "2026-12-19" as CalendarDate, followUpAt: new Date("2026-11-26T23:00:00Z") };
  test("due once, after its time, while unanswered and not expired, and with the setting still on", () => {
    expect(quotes.followUpDue(q, { quoteFollowUpDays: 7 }, at, tz)).toBe(true);
    expect(quotes.followUpDue({ ...q, status: "viewed" }, { quoteFollowUpDays: 7 }, at, tz)).toBe(true);
    expect(quotes.followUpDue(q, {}, at, tz)).toBe(false);
    expect(quotes.followUpDue(q, { quoteFollowUpDays: 7 }, new Date("2026-11-26T22:59:59Z"), tz)).toBe(false);
    expect(quotes.followUpDue({ ...q, followedUp: true }, { quoteFollowUpDays: 7 }, at, tz)).toBe(false);
    expect(quotes.followUpDue({ ...q, followUpAt: null }, { quoteFollowUpDays: 7 }, at, tz)).toBe(false);
    for (const status of ["accepted", "declined", "expired", "invoiced"] as const) expect(quotes.followUpDue({ ...q, status }, { quoteFollowUpDays: 7 }, at, tz)).toBe(false);
    expect(quotes.followUpDue({ ...q, validUntil: "2026-11-26" as CalendarDate }, { quoteFollowUpDays: 7 }, at, tz)).toBe(false);
  });

  test("its time is fixed at sending: the days after, or none when off", () => {
    expect(quotes.followUpAtOf(new Date("2026-11-20T01:00:00Z"), { quoteFollowUpDays: 7 })).toEqual(new Date("2026-11-27T01:00:00Z"));
    expect(quotes.followUpAtOf(new Date("2026-11-20T01:00:00Z"), {})).toBeNull();
  });
});
