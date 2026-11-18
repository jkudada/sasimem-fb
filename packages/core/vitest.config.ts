import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

/**
 * tools/cpu-clock.ts, found by walking up rather than at a fixed "../../": Stryker runs
 * these tests from a copy of this package one level deeper
 * (packages/core/.stryker-tmp/sandbox-x/), where "../../tools" does not exist and every
 * test file failed to load (nightly mutation job, 2026-11-18).
 */
function cpuClock(): string {
  for (let dir = dirname(fileURLToPath(import.meta.url)); dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, "tools", "cpu-clock.ts");
    if (existsSync(file)) return file;
  }
  throw new Error("tools/cpu-clock.ts not found above packages/core");
}

// T1 (unit) and T1p (property) share this package; they are split by file name
// so the property tier can run at a different iteration count (see setup file).
export default defineProject({
  test: {
    name: "core-unit",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.prop.test.ts"],
    environment: "node",
    setupFiles: [cpuClock()],
  },
});
