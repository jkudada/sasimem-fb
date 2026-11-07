import { expect, test } from "vitest";
import * as gst from "./gst.js";
import { toea } from "./money.js";

test("GST is ten per cent of the amount", () => {
  expect(gst.gstOn(toea(240_000))).toBe(24_000);
  expect(gst.gstOn(toea(18_000))).toBe(1_800);
});

test("GST rounds half a toea up, in integers", () => {
  expect(gst.gstOn(toea(5))).toBe(1);
  expect(gst.gstOn(toea(4))).toBe(0);
  expect(gst.gstOn(toea(15))).toBe(2);
  expect(gst.gstOn(toea(14))).toBe(1);
});

test("GST on a credit mirrors GST on the charge, rounding half away from zero", () => {
  expect(gst.gstOn(toea(-5))).toBe(-1);
  expect(gst.gstOn(toea(-4))).toBe(0);
  expect(gst.gstOn(toea(-240_000))).toBe(-24_000);
});

test("an unregistered landlord never charges GST, even on commercial space or a line marked taxable", () => {
  expect(gst.isTaxable({ orgGstRegistered: false, useType: "commercial", treatment: "inherit" })).toBe(false);
  expect(gst.isTaxable({ orgGstRegistered: false, useType: "commercial", treatment: "taxable" })).toBe(false);
});
