import { expect, test } from "vitest";
import * as gst from "./gst.js";
import { toea } from "./money.js";

test("GST is ten per cent of the amount", () => {
  expect(gst.gstOn(toea(240_000))).toBe(24_000);
  expect(gst.gstOn(toea(18_000))).toBe(1_800);
});
