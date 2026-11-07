// Runs in every T3 worker before its test files. Points the Admin SDK at the
// emulators and gives this worker its own project ID (plan §9.3), so workers
// cannot collide even in collection-group queries.
import { beforeAll } from "vitest";
import { adminDb } from "./index.js"; // reads the environment when called, not when imported

process.env["FIRESTORE_EMULATOR_HOST"] ??= "127.0.0.1:8080";
process.env["FIREBASE_AUTH_EMULATOR_HOST"] ??= "127.0.0.1:9099";
process.env["FIREBASE_STORAGE_EMULATOR_HOST"] ??= "127.0.0.1:9199";
// Tests talk only to emulators. Without this, google-auth-library probes the GCE
// metadata server for credentials and stalls each worker for seconds.
process.env["METADATA_SERVER_DETECTION"] = "none";
process.env["GCLOUD_PROJECT"] = `demo-sasimem-${process.env["VITEST_POOL_ID"] ?? "0"}`;

// The first write in a worker costs ~2 s (gRPC channel plus the emulator creating
// this project). Pay it once here, so it is not charged to whichever test runs first.
beforeAll(async () => {
  await adminDb().doc("_harness/warm-up").set({ at: Date.now() });
}, 30_000);
