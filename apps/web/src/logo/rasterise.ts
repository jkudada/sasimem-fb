/**
 * Draw a logo design to a PNG in the browser (docs/PLAN-TEMPLATES.md §5): at most
 * 400 px, transparent around the shape, from the same layout as the preview. The PNG is
 * uploaded as the org's logo, so the PDF, Storage rules and the 200 KB cap are unchanged.
 */
import { MAX_LOGO_BYTES } from "@sasimem/core";
import type { LogoDesign } from "@sasimem/core/logo";
import { cssFont, loadLogoFonts } from "./fonts.js";
import { ICON_PATHS } from "./icons.js";
import { type Measure, estimate, logoLayout } from "./layout.js";

/** Text widths from a canvas, in the loaded fonts; the estimate where there is no canvas. */
export function canvasMeasure(): Measure {
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx === null) return estimate;
  return (text, font, size) => {
    ctx.font = cssFont(font, size);
    return ctx.measureText(text).width;
  };
}

export async function rasterise(d: LogoDesign): Promise<Blob> {
  await loadLogoFonts();
  const l = logoLayout(d, canvasMeasure());
  const canvas = Object.assign(document.createElement("canvas"), { width: l.width, height: l.height });
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser cannot draw the logo.");

  if (l.shape !== null) {
    ctx.fillStyle = d.background;
    ctx.beginPath();
    if (l.shape.kind === "circle") ctx.arc(l.width / 2, l.height / 2, l.shape.radius, 0, Math.PI * 2);
    else ctx.roundRect(0, 0, l.width, l.height, l.shape.radius);
    ctx.fill();
  }
  ctx.fillStyle = d.colour;
  if (l.icon !== null && d.icon !== "none") {
    ctx.save();
    ctx.translate(l.icon.x, l.icon.y);
    ctx.scale(l.icon.size / 24, l.icon.size / 24);
    ctx.fill(new Path2D(ICON_PATHS[d.icon]), "evenodd");
    ctx.restore();
  }
  ctx.font = cssFont(d.font, l.text.size);
  ctx.textAlign = l.text.anchor === "middle" ? "center" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(d.text, l.text.x, l.text.y);

  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (png === null || png.size > MAX_LOGO_BYTES) throw new Error("The logo could not be made. Please try again.");
  return png;
}
