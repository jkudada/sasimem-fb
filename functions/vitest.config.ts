import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

// T3: Functions against the Firestore, Auth and Storage emulators.
// Isolation without teardown (plan §9.3): a per-worker emulator project ID and a
// random org per test. Nothing is ever cleared.
export default defineProject({
  // Mirrors the paths in tsconfig.json: core is compiled in, not installed.
  resolve: { alias: { "@sasimem/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)) } },
  test: {
    name: "integration",
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["../tools/emulator-global-setup.ts"],
    setupFiles: ["./test/harness/worker-setup.ts"],
  },
});
