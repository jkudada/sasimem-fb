/**
 * The builder's four fonts (OFL / Apache 2.0, Latin subset, from Fontsource; licences
 * beside them). Imported only by the builder, so they load on its route and nowhere else.
 */
import type { LogoFont } from "@sasimem/core/logo";
import lora from "./fonts/lora-latin-700-normal.woff2?url";
import pacifico from "./fonts/pacifico-latin-400-normal.woff2?url";
import robotoSlab from "./fonts/roboto-slab-latin-700-normal.woff2?url";
import workSans from "./fonts/work-sans-latin-700-normal.woff2?url";

export const LOGO_FONT_FACES: Readonly<Record<LogoFont, { readonly family: string; readonly weight: number; readonly url: string }>> = {
  sans: { family: "Logo Work Sans", weight: 700, url: workSans },
  serif: { family: "Logo Lora", weight: 700, url: lora },
  slab: { family: "Logo Roboto Slab", weight: 700, url: robotoSlab },
  script: { family: "Logo Pacifico", weight: 400, url: pacifico },
};

/** A CSS font shorthand for a canvas, or for the preview's text. */
export const cssFont = (font: LogoFont, size: number): string => {
  const f = LOGO_FONT_FACES[font];
  return `${f.weight} ${size}px "${f.family}"`;
};

let loading: Promise<void> | null = null;

/** Load all four once; resolves even if one fails (the browser's fallback font draws instead). */
export function loadLogoFonts(): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !("fonts" in document)) return Promise.resolve();
  loading ??= Promise.all(Object.values(LOGO_FONT_FACES).map(async (f) => {
    try {
      const face = new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight) });
      document.fonts.add(await face.load());
    } catch {
      // Drawn in the fallback font; the builder still works.
    }
  })).then(() => undefined);
  return loading;
}
