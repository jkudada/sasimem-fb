import { describe, expect, test } from "vitest";
import { formatKina, parseKina, toea } from "./money.js";

describe("toea", () => {
  test("accepts an integer number of toea", () => {
    expect(toea(120050)).toBe(120050);
  });

  test("throws on a non-integer, because a fraction of a toea is not money", () => {
    expect(() => toea(1.5)).toThrow(RangeError);
  });
});

test("toea throws outside ±MAX_SAFE_INTEGER, where integers stop being exact", () => {
  expect(() => toea(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
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
});

test("formatKina renders an amount the way a PNG invoice reads", () => {
  expect(formatKina(toea(120_050))).toBe("K1,200.50");
});
