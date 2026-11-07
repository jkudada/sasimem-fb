import { defineConfig } from "vitest/config";

// One entry point for every Vitest tier. Pick a tier with --project.
//   core-unit, web-unit  T1   (no emulator, milliseconds)
//   core-property        T1p  (fast-check)
//   rules                T2   (Firestore emulator)
//   integration          T3   (Firestore + Auth + Storage emulators)
export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/core/vitest.property.config.ts",
      "apps/web/vitest.config.ts",
      "tests/rules/vitest.config.ts",
      "functions/vitest.config.ts",
    ],
    reporters: ["default", "./tools/slow-test-reporter.ts"],
    // No automatic retries in T1-T3 (plan §9.5). Listed explicitly so nobody adds one.
    retry: 0,
  },
});
