/**
 * Size budgets (gzip), read after `vite build`. Split per screen: a screen loads only
 * when it is opened, so one sum of every screen measured nothing a phone downloads
 * at once, and filled up as screens were added (G2a left 4 KB).
 *
 * - The sign-in route: what a first visit downloads before it can sign in.
 * - The shell: everything that is not a screen (Firebase, Preact, core, the router,
 *   SignedIn). Chunks named in lower case are shared code; SignedIn is the frame.
 * - Each screen: every chunk named in capitals (vite names a chunk after its module,
 *   and screens and their parts are PascalCase), on its own.
 */
import { readdirSync } from "node:fs";

const ASSETS = "dist/assets";
const SCREEN = /^[A-Z][A-Za-z]*-[\w-]+\.js$/;
const FRAME = /^SignedIn-/;

const screens = readdirSync(ASSETS).filter((f) => SCREEN.test(f) && !FRAME.test(f)).sort();
if (screens.length === 0) throw new Error(`No screens in ${ASSETS}: run vite build first.`);

export default [
  {
    name: "sign-in route (JS, gzip)",
    path: [`${ASSETS}/index-*.js`, `${ASSETS}/SignIn-*.js`, `${ASSETS}/Field-*.js`, `${ASSETS}/jsxRuntime-*.js`],
    limit: "70 KB",
    gzip: true,
  },
  {
    name: "signed-in shell: all JS but the screens (gzip)",
    path: [`${ASSETS}/*.js`, ...screens.map((f) => `!${ASSETS}/${f}`)],
    limit: "160 KB", // PLAN-SASIMEM-FB §9's shell budget
    gzip: true,
  },
  ...screens.map((f) => ({
    name: `screen ${f.slice(0, f.indexOf("-"))} (its own JS, gzip)`,
    path: `${ASSETS}/${f}`,
    limit: "8 KB",
    gzip: true,
  })),
];
