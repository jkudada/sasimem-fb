import { describe, expect, test } from "vitest";
import { MAX_EDITABLE_TOEA, amountProblem, formatKina, parseKina, toea } from "./money.js";

describe("toea", () => {
  test("accepts an integer number of toea", () => {
    expect(toea(120050)).toBe(120050);
  });

  test("throws on a non-integer, because a fraction of a toea is not money", () => {
    expect(() => toea(1.5)).toThrow(new RangeError("not a whole, safe number of toea: 1.5"));
  });
});

test("toea throws outside ±MAX_SAFE_INTEGER, where integers stop being exact", () => {
  expect(() => toea(Number.MAX_SAFE_INTEGER + 1)).toThrow(new RangeError("not a whole, safe number of toea: 9007199254740992"));
  expect(() => toea(-Number.MAX_SAFE_INTEGER - 1)).toThrow(RangeError);
  expect(toea(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
});

test("parseKina reads a plain number of kina", () => {
  expect(parseKina("1200")).toBe(120_000);
});

test("parseKina strips the K, thousands commas and whitespace a landlord types", () => {
  expect(parseKina("K1,200")).toBe(120_000);
  expect(parseKina(" 1 200 ")).toBe(120_000);
});

test("parseKina reads toea after the decimal point, with one or two places", () => {
  expect(parseKina("K1,200.50")).toBe(120_050);
  expect(parseKina("237.5")).toBe(23_750);
  expect(parseKina(".75")).toBe(75);
});

test("parseKina rounds half a toea up, not to even, and never drifts like float arithmetic", () => {
  expect(parseKina("0.005")).toBe(1);
  expect(parseKina("0.015")).toBe(2);
  expect(parseKina("0.0049")).toBe(0);
  expect(parseKina("1.005")).toBe(101); // 1.005 * 100 === 100.49999999999999 in floats
});

test("parseKina reads a minus sign as a credit, rounding half a toea away from zero", () => {
  expect(parseKina("-50")).toBe(-5_000);
  expect(parseKina("-K50.00")).toBe(-5_000);
  expect(parseKina("-0.005")).toBe(-1);
});

test("parseKina rejects an empty amount rather than reading it as zero", () => {
  expect(() => parseKina("")).toThrow(SyntaxError);
  expect(() => parseKina(" K ")).toThrow(SyntaxError);
});

test("parseKina rejects anything that is not an amount", () => {
  for (const rubbish of ["abc", "1.2.3", "1-2", "-", ".", "1e3", "12x"]) {
    expect(() => parseKina(rubbish), rubbish).toThrow(SyntaxError);
  }
  expect(() => parseKina("12x")).toThrow(new SyntaxError('not an amount: "12x"'));
});

test("formatKina renders an amount the way a PNG invoice reads", () => {
  expect(formatKina(toea(120_050))).toBe("K1,200.50");
});

test("formatKina shows zero and small amounts with a leading zero", () => {
  expect(formatKina(toea(0))).toBe("K0.00");
  expect(formatKina(toea(5))).toBe("K0.05");
  expect(formatKina(toea(100))).toBe("K1.00");
});

test("formatKina puts the minus sign before the K on a credit", () => {
  expect(formatKina(toea(-5_000))).toBe("-K50.00");
  expect(formatKina(toea(-5))).toBe("-K0.05");
});

test("an amount above K10,000,000.00 is a validation message, and the limit itself is fine", () => {
  expect(MAX_EDITABLE_TOEA).toBe(1_000_000_000);
  expect(amountProblem(toea(1_000_000_000))).toBeNull();
  expect(amountProblem(toea(-1_000_000_000))).toBeNull();
  expect(amountProblem(toea(1_000_000_001))).toBe("That is more than K10,000,000.00. Check the amount.");
  expect(amountProblem(toea(-1_000_000_001))).toBe("That is more than K10,000,000.00. Check the amount.");
});
