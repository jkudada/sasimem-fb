import { defineProject } from "vitest/config";

// T1: the ops scripts' decisions, with no network. The scripts themselves are thin.
export default defineProject({
  test: { name: "ops-unit", include: ["test/**/*.test.ts"], environment: "node" },
});
