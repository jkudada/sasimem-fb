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
    setupFiles: ["./test-setup.tsx"],
  },
});
