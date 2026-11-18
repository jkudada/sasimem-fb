import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import preact from "@preact/preset-vite";

// T1 for the operator console. Like web-unit: happy-dom, once per worker.
export default defineProject({
  plugins: [preact()],
  test: {
    name: "console-unit",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    environment: "happy-dom",
    pool: "vmThreads",
    setupFiles: [fileURLToPath(new URL("../../tools/cpu-clock.ts", import.meta.url)), "./test-setup.tsx"],
  },
});
