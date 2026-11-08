import { defineProject } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineProject({
  plugins: [preact()],
  test: {
    name: "web-unit",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    environment: "happy-dom",
    // One happy-dom per worker, not one per file (it was ~10 s of a 22 s run); each
    // file still gets its own module context, so no state leaks between files.
    pool: "vmThreads",
    setupFiles: ["./test-setup.tsx"],
  },
});
