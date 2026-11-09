/**
 * Where everything in a logo goes (docs/PLAN-TEMPLATES.md §5). One function for the
 * SVG preview and the canvas export, so what is saved is what was shown. `measure`
 * gives a text's width in the logo's font; the builder measures with a canvas once
 * the fonts have loaded, and tests (no canvas) use the estimate.
 */
import type { LogoDesign, LogoFont } from "@sasimem/core/logo";

export type Measure = (text: string, font: LogoFont, size: number) => number;

/** A rough width: good enough before fonts load, and where there is no canvas. */
export const estimate: Measure = (text, font, size) => text.length * size * (font === "script" ? 0.66 : 0.6);

export interface LogoLayout {
  readonly width: number;
  readonly height: number;
  readonly shape: { readonly kind: "circle" | "rounded"; readonly radius: number } | null;
  readonly icon: { readonly x: number; readonly y: number; readonly size: number } | null;
  readonly text: { readonly x: number; readonly y: number; readonly size: number; readonly anchor: "middle" | "start" };
}

/** The PNG's largest side, as prepareLogo keeps it (functions/src/pdf.ts). */
export const LOGO_PX = 400;

/** The biggest size up to `max` at which the text fits `width`. */
const fit = (d: LogoDesign, measure: Measure, max: number, width: number): number => {
  const w = measure(d.text, d.font, max);
  return Math.floor(w <= width ? max : (max * width) / w);
};

// The text's visual middle sits about 0.35 em above its baseline.
const baseline = (middle: number, size: number) => Math.round(middle + size * 0.35);

export function logoLayout(d: LogoDesign, measure: Measure = estimate): LogoLayout {
  if (d.shape === "none") {
    // A wordmark, about the letterhead's shape (160 × 60 points); as wide as its text.
    const height = 160;
    const icon = d.icon === "none" ? null : { x: 16, y: 20, size: 120 };
    const x = icon === null ? 16 : 150;
    const size = fit(d, measure, 110, LOGO_PX - x - 16);
    const width = Math.min(LOGO_PX, Math.ceil(x + measure(d.text, d.font, size) + 16));
    return { width, height, shape: null, icon, text: { x, y: baseline(height / 2, size), size, anchor: "start" } };
  }
  // A badge: a 400 px circle or rounded square, the icon above the text.
  const shape = { kind: d.shape, radius: d.shape === "circle" ? LOGO_PX / 2 : 72 };
  const room = d.shape === "circle" ? 280 : 320;
  if (d.icon === "none") {
    const size = fit(d, measure, 180, room);
    return { width: LOGO_PX, height: LOGO_PX, shape, icon: null, text: { x: 200, y: baseline(200, size), size, anchor: "middle" } };
  }
  const size = fit(d, measure, 96, room);
  return { width: LOGO_PX, height: LOGO_PX, shape, icon: { x: 125, y: 50, size: 150 }, text: { x: 200, y: baseline(290, size), size, anchor: "middle" } };
}
