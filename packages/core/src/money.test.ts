import { describe, expect, test } from "vitest";
import { toea } from "./money.js";

describe("toea", () => {
  test("accepts an integer number of toea", () => {
    expect(toea(120050)).toBe(120050);
  });

  test("throws on a non-integer, because a fraction of a toea is not money", () => {
    expect(() => toea(1.5)).toThrow(RangeError);
  });
});
