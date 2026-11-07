import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";

/**
 * T2 harness. Each Vitest worker loads the rules into its own emulator project
 * (demo-sasimem-rules-<worker>), so rules files run in parallel without
 * interfering, and nothing is ever cleared between tests (plan §9.3).
 */
export async function rulesEnv(opts: { storage?: boolean } = {}): Promise<RulesTestEnvironment> {
  const [host, port] = (process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080").split(":");
  const [sHost, sPort] = (process.env["FIREBASE_STORAGE_EMULATOR_HOST"] ?? "127.0.0.1:9199").split(":");
  return initializeTestEnvironment({
    projectId: opts.storage === true ? STORAGE_PROJECT : `demo-sasimem-rules-${process.env["VITEST_POOL_ID"] ?? "0"}`,
    firestore: { rules: rules("firestore.rules"), host: host ?? "127.0.0.1", port: Number(port) },
    ...(opts.storage === true ? { storage: { rules: rules("storage.rules"), host: sHost ?? "127.0.0.1", port: Number(sPort) } } : {}),
  });
}

const rules = (file: string): string => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

/** A random org ID: each test asserts only under its own org. */
export const randomOrgId = (): string => `org-${crypto.randomUUID()}`;

/**
 * The Storage emulator answers firestore.get() in storage.rules from the project the
 * emulators were started with, not the caller's, so Storage rules tests share that
 * project. Random org IDs still keep tests apart.
 */
const STORAGE_PROJECT = "demo-sasimem";
