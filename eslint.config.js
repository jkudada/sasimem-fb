import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";

const noParseFloat = { name: "parseFloat", message: "Use parseKina from @sasimem/core; never parseFloat money." };

const focusedOrSkipped = ["only", "skip"].flatMap((m) =>
  ["test", "it", "describe"].map((obj) => ({
    selector: `MemberExpression[object.name='${obj}'][property.name='${m}']`,
    message: `${obj}.${m} is not allowed: never get speed or green by skipping (plan §9.5). Use test.todo for planned tests.`,
  })),
);

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/lib/**", "**/coverage/**", "**/reports/**", "**/.stryker-tmp/**", "reference/**", ".attachments/**", ".worktrees/**" /* other checkouts of this repo, linted from their own root */] },
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // "_x" marks a parameter deliberately unused, e.g. a triangulation step that hard-codes its answer.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": ["error", ...focusedOrSkipped],
    },
  },
  {
    // Money is integer toea (plan §3.1, I7). parseFloat on an amount is the classic drift bug.
    files: ["packages/core/**/*.ts", "functions/**/*.ts", "apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", noParseFloat],
      "no-restricted-properties": ["error", { object: "Number", property: "parseFloat", message: "Use parseKina from @sasimem/core." }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/e2e/**/*.ts"],
    plugins: { vitest },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
      // Use the clock, never sleep (plan §9.3).
      "no-restricted-globals": ["error", noParseFloat, { name: "setTimeout", message: "Tests inject `now`; they never sleep." }, { name: "setInterval", message: "No polling in tests." }],
      "no-restricted-properties": ["error", { object: "Number", property: "parseFloat", message: "Use parseKina from @sasimem/core." }, { property: "waitForTimeout", message: "Playwright waits on conditions only (plan §9.3)." }],
    },
  },
);
