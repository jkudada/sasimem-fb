import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

// T1: the ops scripts' decisions, with no network. The scripts themselves are thin.
export default defineProject({
  // Tests compare the scripts' copies with core; the scripts themselves never import it.
  resolve: { alias: { "@sasimem/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)) } },
  test: { name: "ops-unit", include: ["test/**/*.test.ts"], environment: "node" },
});
