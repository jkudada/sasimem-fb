import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";

/**
 * T2 harness. Each Vitest worker loads the rules into its own emulator project
 * (demo-sasimem-rules-<worker>), so rules files run in parallel without
 * interfering, and nothing is ever cleared between tests (plan §9.3).
 */
export async function rulesEnv(): Promise<RulesTestEnvironment> {
  const [host, port] = (process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080").split(":");
  return initializeTestEnvironment({
    projectId: `demo-sasimem-rules-${process.env["VITEST_POOL_ID"] ?? "0"}`,
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: host ?? "127.0.0.1", port: Number(port) },
  });
}

/** A random org ID: each test asserts only under its own org. */
export const randomOrgId = (): string => `org-${crypto.randomUUID()}`;
