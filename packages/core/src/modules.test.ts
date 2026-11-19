import { describe, expect, test } from "vitest";
import * as modules from "./modules.js";

describe("an org's modules and features", () => {
  test("an org with nothing stored is a Rentals org with today's features", () => {
    expect(modules.orgModules({})).toEqual(["rentals"]);
    expect(modules.orgFeatures({})).toEqual({ rentals: true, repeating: true, oneOff: false, quotes: false, tradeJobs: false });
  });

  test("stored modules and features are used", () => {
    const org = { modules: ["trades", "general"], features: { oneOff: true, quotes: true } };
    expect(modules.orgModules(org)).toEqual(["trades", "general"]);
    expect(modules.orgFeatures(org)).toEqual({ rentals: false, repeating: false, oneOff: true, quotes: true, tradeJobs: false });
  });

  test("with no features stored, they follow the modules", () => {
    expect(modules.orgFeatures({ modules: ["general", "rentals"] })).toEqual({ rentals: true, repeating: true, oneOff: false, quotes: false, tradeJobs: false });
    expect(modules.orgFeatures({ modules: ["trades"], features: null })).toEqual({ rentals: false, repeating: false, oneOff: false, quotes: false, tradeJobs: false });
  });

  test("unknown names and non-true values are dropped, not trusted", () => {
    expect(modules.orgModules({ modules: ["rentals", "casino", 7] })).toEqual(["rentals"]);
    expect(modules.orgModules({ modules: "rentals" })).toEqual(["rentals"]); // not a list: the default
    expect(modules.orgModules({ modules: [] })).toEqual(["rentals"]); // an org always has a module
    const features = modules.orgFeatures({ modules: ["general"], features: { oneOff: "yes", quotes: true, teleport: true } });
    expect(features).toEqual({ rentals: false, repeating: false, oneOff: false, quotes: true, tradeJobs: false });
  });

  test("hasFeature answers from the defaults when nothing is stored", () => {
    expect(modules.hasFeature({}, "repeating")).toBe(true);
    expect(modules.hasFeature({}, "quotes")).toBe(false);
    expect(modules.hasFeature({ features: { quotes: true } }, "quotes")).toBe(true);
  });
});

describe("document numbers", () => {
  test("each kind has its counter field and default prefix", () => {
    expect(modules.COUNTERS).toEqual({
      invoice: { field: "nextInvoiceNumber", prefix: "INV-" },
      quote: { field: "nextQuoteNumber", prefix: "QUO-" },
      creditNote: { field: "nextCreditNoteNumber", prefix: "CN-" },
      receipt: { field: "nextReceiptNumber", prefix: "RCT-" },
    });
  });

  test("a missing or broken counter field reads as 1", () => {
    expect(modules.nextNumberOf({}, "quote")).toBe(1);
    expect(modules.nextNumberOf({ nextQuoteNumber: "7" }, "quote")).toBe(1);
    expect(modules.nextNumberOf({ nextQuoteNumber: 7, nextInvoiceNumber: 142 }, "quote")).toBe(7);
    expect(modules.nextNumberOf({ nextInvoiceNumber: 142 }, "invoice")).toBe(142);
  });

  test("the invoice prefix comes from the org; the others are fixed", () => {
    expect(modules.documentNumber("invoice", 142, { invoicePrefix: "WK-" })).toBe("WK-0142");
    expect(modules.documentNumber("quote", 12, { invoicePrefix: "WK-" })).toBe("QUO-0012");
    expect(modules.documentNumber("creditNote", 3, { invoicePrefix: "WK-" })).toBe("CN-0003");
  });
});
