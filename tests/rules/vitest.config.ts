import { defineProject } from "vitest/config";

// T2: security rules against the Firestore emulator. Each worker loads the rules
// into its own project ID, so files can run in parallel without interfering.
export default defineProject({
  test: {
    name: "rules",
    include: ["**/*.test.ts"],
    environment: "node",
    globalSetup: ["../../tools/emulator-global-setup.ts"],
  },
});
