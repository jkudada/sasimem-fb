import fc from "fast-check";
import { expect, test } from "vitest";
import { MAX_QUANTITY, formatQuantity, lineAmount, parseQuantity } from "./lines.js";
import { MAX_EDITABLE_TOEA, toea } from "./money.js";

const quantity = fc.integer({ min: 1, max: MAX_QUANTITY });

test("every valid quantity survives formatQuantity then parseQuantity unchanged", () => {
  fc.assert(fc.property(quantity, (q) => parseQuantity(formatQuantity(q)) === q));
});

// Oracle in BigInt: round |q × p| / 1000 half up, then restore the sign.
function oracle(q: number, p: number): number {
  const magnitude = (BigInt(q) * BigInt(Math.abs(p)) * 2n + 1000n) / 2000n;
  return Number(p < 0 ? -magnitude : magnitude) + 0;
}

test("lineAmount agrees with exact integer arithmetic for any quantity and price", () => {
  fc.assert(
    fc.property(quantity, fc.integer({ min: -MAX_EDITABLE_TOEA, max: MAX_EDITABLE_TOEA }), (q, p) => {
      expect(lineAmount(q, toea(p))).toBe(oracle(q, p));
    }),
  );
});
