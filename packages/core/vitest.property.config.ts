import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "core-property",
    include: ["src/**/*.prop.test.ts"],
    environment: "node",
    setupFiles: ["../../tools/fast-check-setup.ts"],
  },
});
