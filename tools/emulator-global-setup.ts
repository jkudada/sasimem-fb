// Runs once per Vitest run (not per file). Locally the emulators stay running in
// another terminal (`pnpm emulators`); in CI `firebase emulators:exec` starts them.
// Either way this only checks they are reachable, and fails fast with a hint.
const HOSTS: Record<string, string> = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
};

export default async function setup(): Promise<void> {
  for (const [key, fallback] of Object.entries(HOSTS)) process.env[key] ??= fallback;
  // One ID per Vitest run, inherited by its workers, which put it in their project IDs
  // (functions/test/harness/worker-setup.ts). The emulator keeps data between runs, and
  // a few documents are project-wide: the operator digest's once-a-day claim, Sasimem's
  // billing settings. The nightly flake detector runs T3 five times on one emulator, and
  // a test that passed in run 1 found run 1's digest claim in run 2 and sent nothing.
  process.env["SASIMEM_T3_RUN"] ??= Date.now().toString(36);
  const firestore = process.env["FIRESTORE_EMULATOR_HOST"];
  try {
    await fetch(`http://${firestore}/`);
  } catch {
    throw new Error(`Firestore emulator not reachable at ${firestore}. Start it with \`pnpm emulators\`.`);
  }
}
