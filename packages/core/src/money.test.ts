import { describe, expect, test } from "vitest";
import { parseKina, toea } from "./money.js";

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
