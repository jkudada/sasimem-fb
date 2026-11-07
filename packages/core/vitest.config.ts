import { defineProject } from "vitest/config";

// T1 (unit) and T1p (property) share this package; they are split by file name
// so the property tier can run at a different iteration count (see setup file).
export default defineProject({
  test: {
    name: "core-unit",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.prop.test.ts"],
    environment: "node",
  },
});
