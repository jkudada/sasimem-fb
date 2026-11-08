import { defineConfig, devices } from "@playwright/test";

// T4: the four critical journeys only (plan §9.2). PRs: Chromium at 360 x 740.
// Nightly adds WebKit and Firefox (E2E_ALL_BROWSERS=1) and a throttled phone
// (E2E_THROTTLED=1: Slow 4G and a 4x slower CPU, the journeys plus the sign-in budget).
const phone = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };
const BUDGET = /budget\.spec\.ts/;

export default defineConfig<{ throttled: boolean }>({
  testDir: "e2e",
  retries: 1, // the one tier allowed a retry; a pass-on-retry is reported as flaky
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  // The Hosting emulator: the app built with --mode emulator, and /a/** rewritten to the
  // approval page. Started around the run by `pnpm ci:e2e` (emulators:exec).
  use: { baseURL: "http://127.0.0.1:5000", ...phone },
  projects: [
    { name: "chromium", testIgnore: BUDGET, use: { ...devices["Desktop Chrome"], ...phone } },
    ...(process.env["E2E_ALL_BROWSERS"]
      ? [
          { name: "webkit", testIgnore: BUDGET, use: { ...devices["Desktop Safari"], ...phone, isMobile: false } },
          { name: "firefox", testIgnore: BUDGET, use: { ...devices["Desktop Firefox"], ...phone, isMobile: false } },
        ]
      : []),
    ...(process.env["E2E_THROTTLED"]
      ? [{ name: "throttled phone", timeout: 180_000, use: { ...devices["Desktop Chrome"], ...phone, throttled: true } }]
      : []),
  ],
});
