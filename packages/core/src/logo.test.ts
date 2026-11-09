import { describe, expect, test } from "vitest";
import { type LogoDesign, LOGO_COLOURS, MAX_LOGO_TEXT, defaultLogoDesign, logoDesignOf, logoDesignProblems } from "./logo.js";

const wh: LogoDesign = { text: "WH", shape: "circle", background: "#1f4e8c", colour: "#ffffff", font: "serif", icon: "house" };

describe("logo designs (docs/PLAN-TEMPLATES.md §5)", () => {
  test("a first design is the org's initials, white on a circle", () => {
    expect(defaultLogoDesign("Wari Holdings")).toEqual({ text: "WH", shape: "circle", background: "#0d6b4f", colour: "#ffffff", font: "sans", icon: "none" });
    expect(logoDesignProblems(defaultLogoDesign("Wari Holdings"))).toEqual({});
  });

  test("text must be 1-24 characters", () => {
    expect(logoDesignProblems({ ...wh, text: "  " }).text).toMatch(/initials or a short name/);
    expect(logoDesignProblems({ ...wh, text: "x".repeat(MAX_LOGO_TEXT) })).toEqual({});
    expect(logoDesignProblems({ ...wh, text: "x".repeat(MAX_LOGO_TEXT + 1) }).text).toMatch(/24 characters/);
  });

  test("an unknown shape, font, icon or off-palette colour is refused", () => {
    const bad = { ...wh, shape: "hexagon", font: "comic", icon: "dragon", background: "#ff0000", colour: "red" } as unknown as LogoDesign;
    expect(Object.keys(logoDesignProblems(bad)).sort()).toEqual(["background", "colour", "font", "icon", "shape"]);
  });

  test("text that would not show is refused: white with no shape, or the shape's own colour", () => {
    expect(logoDesignProblems({ ...wh, shape: "none" }).colour).toMatch(/White text needs a shape/);
    expect(logoDesignProblems({ ...wh, shape: "none", colour: "#1c2321" })).toEqual({});
    expect(logoDesignProblems({ ...wh, colour: "#1f4e8c" }).colour).toMatch(/different/);
  });

  test("the palette is the invoice colours plus white and ink; a design keeps only its own fields, trimmed", () => {
    expect(LOGO_COLOURS.map((c) => c.label).slice(-2)).toEqual(["White", "Ink"]);
    expect(logoDesignOf({ ...wh, text: " WH ", extra: 1 } as LogoDesign)).toEqual(wh);
  });
});
