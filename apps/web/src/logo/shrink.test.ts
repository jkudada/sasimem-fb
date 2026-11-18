import { describe, expect, test } from "vitest";
import { fitLogo } from "./shrink.js";

// Drawing and encoding need a real canvas: journey 7 shrinks a real photo in the browser.
describe("the size a picked logo is drawn at", () => {
  test("a big picture fits 400 px on its longer side and keeps its shape", () => {
    expect(fitLogo(4000, 3000)).toEqual({ width: 400, height: 300 });
    expect(fitLogo(1000, 2000)).toEqual({ width: 200, height: 400 });
  });

  test("a picture already within 400 px keeps its size", () => {
    expect(fitLogo(320, 120)).toEqual({ width: 320, height: 120 });
  });

  test("a very thin picture is never drawn 0 px high", () => {
    expect(fitLogo(10_000, 3)).toEqual({ width: 400, height: 1 });
  });
});
