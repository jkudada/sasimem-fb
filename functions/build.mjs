// Bundle the Functions source with @sasimem/core compiled in, because Cloud
// Functions installs dependencies from npm and cannot see a workspace package.
// firebase-admin and firebase-functions stay external and are installed normally.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: ["firebase-admin", "firebase-functions"],
  logLevel: "info",
});
