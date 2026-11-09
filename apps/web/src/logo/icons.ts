/**
 * The logo builder's icons (docs/PLAN-TEMPLATES.md §5): filled paths on a 24 × 24 grid,
 * drawn here for Sasimem. One path each, filled with the even-odd rule, so the SVG
 * preview and the canvas export draw them the same way.
 */
import type { LogoIcon } from "@sasimem/core/logo";

export const ICON_PATHS: Readonly<Record<Exclude<LogoIcon, "none">, string>> = {
  house: "M12 3 L2 11.5 H5 V21 H10 V15 H14 V21 H19 V11.5 H22 Z",
  building: "M5 2 H19 V22 H14 V18 H10 V22 H5 Z M8 5 V7.5 H10.5 V5 Z M13.5 5 V7.5 H16 V5 Z M8 9.5 V12 H10.5 V9.5 Z M13.5 9.5 V12 H16 V9.5 Z M8 14 V16 H10.5 V14 Z M13.5 14 V16 H16 V14 Z",
  key: "M7 7 A5 5 0 1 0 11.9 13 H15 V16 H17 V13 H18.5 V15 H20.5 V13 H22 V11 H11.9 A5 5 0 0 0 7 7 Z M7 10 A2 2 0 1 1 7 14 A2 2 0 1 1 7 10 Z",
  palm: "M11.4 22 L12 11 H13 L14.6 22 Z M12.5 11 C9 6.5 5 7 2.5 9.5 C6 8.2 9 9 12.5 11 Z M12.5 11 C16 6.5 20 7 22.5 9.5 C19 8.2 16 9 12.5 11 Z M12.5 11 C11.5 6 8.5 3 5 3 C8.5 4.8 10.5 7 12.5 11 Z M12.5 11 C13.5 6 16.5 3 20 3 C16.5 4.8 14.5 7 12.5 11 Z",
  wave: "M2 12 C5 8 8 8 11 12 S17 16 20 12 C20.7 11.2 21.3 10.8 22 10.6 V20 H2 Z",
  mountain: "M1.5 20 L9 6 L13.5 14 L16.5 10 L22.5 20 Z",
  leaf: "M20.5 3.5 C10 3.5 4 9 4 15.5 C4 16.8 4.3 17.8 4.8 18.6 L2.5 21 L3.6 22 L6 19.7 C6.9 20.2 8 20.5 9.2 20.5 C16 20.5 20.5 13.5 20.5 3.5 Z",
  star: "M12 2.5 L14.47 9.1 L21.51 9.41 L15.99 13.8 L17.88 20.59 L12 16.7 L6.12 20.59 L8.01 13.8 L2.49 9.41 L9.53 9.1 Z",
};
