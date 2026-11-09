import { describe, expect, test } from "vitest";
import { ACCENTS, CLASSIC, type InvoiceTemplate, initials, resolveTemplate, templateDeleteProblem, templateFor, templateOf, templateProblems } from "./templates.js";

const band: InvoiceTemplate = { name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "monogram", footer: "Thank you." };

/** WCAG relative luminance contrast against white. */
const contrastOnWhite = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) + 0.05);
};

describe("resolveTemplate", () => {
  test("with no ids and no templates it is built-in Classic, today's look", () => {
    expect(resolveTemplate([], {})).toEqual(CLASSIC);
    expect(CLASSIC).toEqual({ name: "Classic", layout: "classic", accent: "#0d6b4f", font: "helvetica", mark: "logo", footer: "" });
  });

  test("the org default is used when it exists", () => {
    expect(resolveTemplate(["t1"], { t1: band })).toEqual(band);
  });

  test("a dangling id falls through to the next, then to Classic", () => {
    expect(resolveTemplate(["gone", "t1"], { t1: band })).toEqual(band);
    expect(resolveTemplate(["gone"], { t1: band })).toEqual(CLASSIC);
    expect(resolveTemplate([undefined, null, "t1"], { t1: band })).toEqual(band);
  });

  test("the most specific id wins (tenancy, then property, then org)", () => {
    const compact = { ...band, name: "Plain", layout: "compact" as const };
    expect(resolveTemplate(["t2", "t1"], { t1: band, t2: compact })).toEqual(compact);
  });

  test("an id like a built-in object key is not a template", () => {
    expect(resolveTemplate(["toString", "constructor"], {})).toEqual(CLASSIC);
  });

  test("only the template's own fields are kept, so stray keys never reach a snapshot", () => {
    expect(resolveTemplate(["t1"], { t1: { ...band, createdAt: 1 } as InvoiceTemplate })).toEqual(band);
    expect(templateOf({ ...band, extra: true } as InvoiceTemplate)).toEqual(band);
  });
});

describe("templateProblems", () => {
  test("a good template has none", () => {
    expect(templateProblems(band)).toEqual({});
    expect(templateProblems(CLASSIC)).toEqual({});
  });

  test("name 1-40, a known layout, a palette colour, a known font and mark, a footer up to 200", () => {
    expect(Object.keys(templateProblems({
      name: "  ", layout: "fancy" as never, accent: "#ff0000", font: "comic" as never, mark: "stamp" as never, footer: "x".repeat(201),
    })).sort()).toEqual(["accent", "font", "footer", "layout", "mark", "name"]);
    expect(templateProblems({ ...band, name: "x".repeat(41) }).name).toMatch(/40 characters/);
    expect(templateProblems({ ...band, name: "x".repeat(40), footer: "x".repeat(200) })).toEqual({});
  });
});

test("every accent prints legibly: at least 4.5:1 against white, and all distinct", () => {
  for (const a of ACCENTS) expect(contrastOnWhite(a.hex), a.label).toBeGreaterThanOrEqual(4.5);
  expect(new Set(ACCENTS.map((a) => a.hex)).size).toBe(ACCENTS.length);
  expect(ACCENTS[0]?.hex).toBe(CLASSIC.accent);
});

test("initials: up to two, from words that start with a letter, S when there are none", () => {
  expect(initials("Wari Holdings Ltd")).toBe("WH");
  expect(initials("mary")).toBe("M");
  expect(initials("123 456")).toBe("S");
});

describe("templateFor: tenancy, then property, then the org's default (P2)", () => {
  const compact: InvoiceTemplate = { ...band, name: "Plain", layout: "compact" };
  const classicGreen: InvoiceTemplate = { ...band, name: "Office", layout: "classic" };
  const all = { t1: band, t2: compact, t3: classicGreen };

  test("a tenancy override beats the property's, which beats the org default", () => {
    const org = { defaultTemplateId: "t1" };
    expect(templateFor({ org }, all)).toEqual(band);
    expect(templateFor({ org, property: { templateId: "t2" } }, all)).toEqual(compact);
    expect(templateFor({ org, property: { templateId: "t2" }, tenancy: { templateId: "t3" } }, all)).toEqual(classicGreen);
    expect(templateFor({ org, property: {}, tenancy: {} }, all)).toEqual(band);
    expect(templateFor({}, all)).toEqual(CLASSIC);
  });

  test("a dangling id falls through level by level", () => {
    const org = { defaultTemplateId: "t1" };
    expect(templateFor({ org, property: { templateId: "t2" }, tenancy: { templateId: "gone" } }, all)).toEqual(compact);
    expect(templateFor({ org, property: { templateId: "gone" }, tenancy: { templateId: "gone" } }, all)).toEqual(band);
    expect(templateFor({ org: { defaultTemplateId: "gone" }, property: { templateId: "gone" } }, all)).toEqual(CLASSIC);
  });
});

describe("templateDeleteProblem", () => {
  test("the default, or a template a property or tenancy uses, is kept; others can go", () => {
    const none = { properties: [], tenancies: [] };
    expect(templateDeleteProblem("t1", { ...none, defaultTemplateId: "t1" })).toMatch(/default template/);
    expect(templateDeleteProblem("t1", { properties: [{ templateId: "t1" }], tenancies: [] })).toBe("1 property uses this template. Set it to another template first.");
    expect(templateDeleteProblem("t1", { properties: [{ templateId: "t1" }, { templateId: "t1" }], tenancies: [{ templateId: "t1" }, {}] }))
      .toBe("2 properties and 1 tenancy use this template. Set them to another template first.");
    expect(templateDeleteProblem("t1", { properties: [{}, { templateId: "t2" }], tenancies: [{ templateId: "t2" }], defaultTemplateId: "t2" })).toBeNull();
  });
});
