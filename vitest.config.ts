import { defineConfig } from "vitest/config";

// One entry point for every Vitest tier. Pick a tier with --project.
//   core-unit, web-unit,
//   console-unit, ops-unit T1  (no emulator, milliseconds)
//   core-property        T1p  (fast-check)
//   rules                T2   (Firestore emulator)
//   integration          T3   (Firestore + Auth + Storage emulators)
export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/core/vitest.property.config.ts",
      "apps/web/vitest.config.ts",
      "apps/console/vitest.config.ts",
      "tests/rules/vitest.config.ts",
      "functions/vitest.config.ts",
      "ops/vitest.config.ts",
    ],
    reporters: ["default", "./tools/slow-test-reporter.ts"],
    // No automatic retries in T1-T3 (plan §9.5). Listed explicitly so nobody adds one.
    retry: 0,
    // Coverage is reported, never a target to game (plan §9.5). These are floors.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts", "**/types.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        "**/packages/core/src/**/*.ts": { branches: 95 },
        "**/functions/src/**/*.ts": { lines: 85 },
      },
    },
  },
});
