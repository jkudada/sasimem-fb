import { describe, expect, test } from "vitest";
import { customerOf } from "./customers.js";
import { parseKina } from "./money.js";
import type { CalendarDate } from "./period.js";
import * as quotes from "./quotes.js";
import type { ItemLineInput } from "./types.js";

const labour: ItemLineInput = { description: "Labour", detail: "", quantityMilli: 2000, unit: "hour", unitPriceToea: parseKina("80"), taxCode: "standard" };
const draft: quotes.QuoteDraft = { customerId: "c1", lines: [labour], notes: "", validDays: null };
const customer = customerOf({ name: "Kila Trading", email: "accounts@kila.example", phone: "" });
const TODAY = "2026-11-19" as CalendarDate;

describe("a quote draft (G2q-a)", () => {
  test("read defensively: missing fields are empty, a bad line reads as a line with problems", () => {
    expect(quotes.quoteDraftOf({})).toEqual({ customerId: "", lines: [], notes: "", validDays: null });
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
