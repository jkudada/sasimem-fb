// Runs in every T3 worker before its test files. Points the Admin SDK at the
// emulators and gives this worker its own project ID (plan §9.3), so workers
// cannot collide even in collection-group queries.
process.env["FIRESTORE_EMULATOR_HOST"] ??= "127.0.0.1:8080";
process.env["FIREBASE_AUTH_EMULATOR_HOST"] ??= "127.0.0.1:9099";
process.env["FIREBASE_STORAGE_EMULATOR_HOST"] ??= "127.0.0.1:9199";
process.env["GCLOUD_PROJECT"] = `demo-sasimem-${process.env["VITEST_POOL_ID"] ?? "0"}`;
