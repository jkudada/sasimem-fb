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

test("a line marked exempt carries no GST, even on commercial space", () => {
  expect(gst.isTaxable({ orgGstRegistered: true, useType: "commercial", treatment: "exempt" })).toBe(false);
});

test("a line marked taxable carries GST, even on residential space", () => {
  expect(gst.isTaxable({ orgGstRegistered: true, useType: "residential", treatment: "taxable" })).toBe(true);
});

test("a line that inherits is taxable on commercial space and exempt on residential", () => {
  expect(gst.isTaxable({ orgGstRegistered: true, useType: "commercial", treatment: "inherit" })).toBe(true);
  expect(gst.isTaxable({ orgGstRegistered: true, useType: "residential", treatment: "inherit" })).toBe(false);
});

test("an unknown treatment is an error, not a silent exemption", () => {
  const maybe = "maybe" as gst.TaxableQuestion["treatment"];
  expect(() => gst.isTaxable({ orgGstRegistered: true, useType: "commercial", treatment: maybe })).toThrow(TypeError);
});

test("the document is an INVOICE when no line is taxable", () => {
  expect(gst.documentTitle({ orgGstRegistered: true, hasTaxableLine: false })).toBe("INVOICE");
});

test("the document is a TAX INVOICE when the landlord is registered and a line is taxable", () => {
  expect(gst.documentTitle({ orgGstRegistered: true, hasTaxableLine: true })).toBe("TAX INVOICE");
});

test("an unregistered landlord issues a plain INVOICE whatever the lines say", () => {
  expect(gst.documentTitle({ orgGstRegistered: false, hasTaxableLine: true })).toBe("INVOICE");
});

test("a GST-registered landlord must record a GST number; blank or whitespace is missing", () => {
  const message = "A GST-registered landlord must enter their GST number: it is printed on every tax invoice.";
  expect(gst.gstNumberProblem({ gstRegistered: true, gstNumber: "" })).toBe(message);
  expect(gst.gstNumberProblem({ gstRegistered: true, gstNumber: "   " })).toBe(message);
  expect(gst.gstNumberProblem({ gstRegistered: true, gstNumber: "500012345" })).toBeNull();
  expect(gst.gstNumberProblem({ gstRegistered: false, gstNumber: "" })).toBeNull();
});
