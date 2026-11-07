// Bundle the Functions source with @sasimem/core compiled in, because Cloud
// Functions installs dependencies from npm and cannot see a workspace package.
// firebase-admin, firebase-functions, pdfkit and sharp stay external and are installed normally.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // pdfkit reads its font metrics from its package folder, and sharp is native: both installed normally.
  external: ["firebase-admin", "firebase-functions", "pdfkit", "sharp"],
  logLevel: "info",
});
