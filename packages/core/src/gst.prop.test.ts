import fc from "fast-check";
import { expect, test } from "vitest";
import { gstOn } from "./gst.js";
import { MAX_EDITABLE_TOEA, toea } from "./money.js";

const amount = fc.integer({ min: -MAX_EDITABLE_TOEA, max: MAX_EDITABLE_TOEA }).map(toea);

test("GST on a credit is exactly the negative of GST on the charge it reverses", () => {
  fc.assert(fc.property(amount, (a) => {
    expect(gstOn(toea(-a))).toBe(-gstOn(a) + 0);
  }));
});
