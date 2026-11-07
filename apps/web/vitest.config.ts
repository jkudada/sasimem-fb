import { defineProject } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineProject({
  plugins: [preact()],
  test: {
    name: "web-unit",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["./test-setup.tsx"],
  },
});
