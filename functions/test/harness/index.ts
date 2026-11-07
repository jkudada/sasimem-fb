import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * T3 harness. Real emulators, never mocks (plan §9.1). Isolation comes from
 * a per-worker project ID (set in worker-setup.ts) plus a random org per test;
 * nothing is ever cleared.
 */
export const workerProjectId = (): string => {
  const id = process.env["GCLOUD_PROJECT"];
  if (id === undefined || !id.startsWith("demo-")) throw new Error("T3 must run against a demo- emulator project");
  return id;
};

function app(): App {
  return getApps()[0] ?? initializeApp({ projectId: workerProjectId() });
}

export const adminDb = (): Firestore => getFirestore(app());

/** A fresh org ID: every T3 test creates its own org and asserts only under it. */
export const randomOrgId = (): string => `org-${crypto.randomUUID()}`;
