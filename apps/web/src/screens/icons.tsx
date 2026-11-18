/** Line icons for the menu and the app frame: inline SVG, stroked in the current colour, hidden from screen readers. */
import type { JSX } from "preact";

const PATHS = {
  invoices: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  properties: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M10 10h4",
  tenants: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4",
  plus: "M12 5v14M5 12h14",
  signOut: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  owed: "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6",
  home: "M3 11l9-8 9 8M5 9v12h14V9",
  arrow: "M5 12h14M13 6l6 6-6 6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; class?: string }): JSX.Element {
  return (
    <svg class={`icon ${props.class ?? ""}`} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[props.name]} />
    </svg>
  );
}

/** Sasimem's mark: a folded invoice on a rounded square. */
export function Mark(): JSX.Element {
  return (
    <svg class="mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" style={{ fill: "var(--mark-bg)" }} />
      <path d="M10 8h8l4 4v12H10z" style={{ fill: "var(--mark-paper)" }} />
      <path d="M18 8v4h4" fill="none" style={{ stroke: "var(--mark-ink)" }} stroke-width="1.5" stroke-linejoin="round" opacity="0.35" />
      <path d="M13 17h6M13 20h4" style={{ stroke: "var(--mark-ink)" }} stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}
