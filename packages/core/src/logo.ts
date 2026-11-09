/**
 * The logo builder's inputs (docs/PLAN-TEMPLATES.md §5). The builder draws them and
 * uploads a PNG as the org's logo; these are kept beside it (orgs/{id}.logoDesign) only
 * so it reopens with the same choices. Nothing that prints reads them. firestore.rules
 * checks the same limits.
 */
import { ACCENTS, initials } from "./templates.js";
import type { Problems } from "./types.js";

export type LogoShape = "circle" | "rounded" | "none";
export type LogoFont = "sans" | "serif" | "slab" | "script";
export type LogoIcon = "none" | "house" | "building" | "key" | "palm" | "wave" | "mountain" | "leaf" | "star";

export interface LogoDesign {
  /** Initials or a short name, 1-24 characters. */
  readonly text: string;
  readonly shape: LogoShape;
  /** Behind the text; unused with no shape. One of LOGO_COLOURS. */
  readonly background: string;
  /** The text and icon. One of LOGO_COLOURS. */
  readonly colour: string;
  readonly font: LogoFont;
  readonly icon: LogoIcon;
}

export const MAX_LOGO_TEXT = 24;
export const WHITE = "#ffffff";
export const INK = "#1c2321";

export const LOGO_SHAPES: readonly { readonly id: LogoShape; readonly label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "rounded", label: "Rounded square" },
  { id: "none", label: "No shape (a wordmark)" },
];

export const LOGO_FONTS: readonly { readonly id: LogoFont; readonly label: string }[] = [
  { id: "sans", label: "Modern" },
  { id: "serif", label: "Classic" },
  { id: "slab", label: "Sturdy" },
  { id: "script", label: "Handwritten" },
];

export const LOGO_ICONS: readonly { readonly id: LogoIcon; readonly label: string }[] = [
  { id: "none", label: "No icon" },
  { id: "house", label: "House" },
  { id: "building", label: "Building" },
  { id: "key", label: "Key" },
  { id: "palm", label: "Palm" },
  { id: "wave", label: "Wave" },
  { id: "mountain", label: "Mountain" },
  { id: "leaf", label: "Leaf" },
  { id: "star", label: "Star" },
];

/** The invoice palette, plus white and ink. */
export const LOGO_COLOURS: readonly { readonly hex: string; readonly label: string }[] = [
  ...ACCENTS, { hex: WHITE, label: "White" }, { hex: INK, label: "Ink" },
];

/** A first design: the org's initials, white on a green circle. */
export const defaultLogoDesign = (orgName: string): LogoDesign =>
  ({ text: initials(orgName), shape: "circle", background: "#0d6b4f", colour: WHITE, font: "sans", icon: "none" });

export function logoDesignProblems(d: LogoDesign): Problems<keyof LogoDesign> {
  const p: Problems<keyof LogoDesign> = {};
  if (d.text.trim() === "") p.text = "Type your initials or a short name.";
  else if (d.text.length > MAX_LOGO_TEXT) p.text = `Keep it to ${MAX_LOGO_TEXT} characters or fewer.`;
  if (!LOGO_SHAPES.some((s) => s.id === d.shape)) p.shape = "Choose a shape.";
  if (!LOGO_FONTS.some((f) => f.id === d.font)) p.font = "Choose a font.";
  if (!LOGO_ICONS.some((i) => i.id === d.icon)) p.icon = "Choose an icon, or no icon.";
  if (!LOGO_COLOURS.some((c) => c.hex === d.background)) p.background = "Choose one of the colours.";
  if (!LOGO_COLOURS.some((c) => c.hex === d.colour)) p.colour = "Choose one of the colours.";
  else if (d.shape === "none" && d.colour === WHITE) p.colour = "White text needs a shape behind it, or it will not show on paper.";
  else if (d.shape !== "none" && d.colour === d.background) p.colour = "Choose a text colour different from the shape's.";
  return p;
}

/** Exactly the design's own fields, trimmed. */
export const logoDesignOf = (d: LogoDesign): LogoDesign =>
  ({ text: d.text.trim(), shape: d.shape, background: d.background, colour: d.colour, font: d.font, icon: d.icon });
