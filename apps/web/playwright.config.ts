import { defineConfig, devices } from "@playwright/test";

// T4: the four critical journeys only (plan §9.2). PRs: Chromium at 360 x 740.
// The nightly job adds WebKit and Firefox via E2E_ALL_BROWSERS=1.
const phone = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };

export default defineConfig({
  testDir: "e2e",
  retries: 1, // the one tier allowed a retry; a pass-on-retry is reported as flaky
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  // The Hosting emulator: the app built with --mode emulator, and /a/** rewritten to the
  // approval page. Started around the run by `pnpm ci:e2e` (emulators:exec).
  use: { baseURL: "http://127.0.0.1:5000", ...phone },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...phone } },
    ...(process.env["E2E_ALL_BROWSERS"]
      ? [
          { name: "webkit", use: { ...devices["Desktop Safari"], ...phone, isMobile: false } },
          { name: "firefox", use: { ...devices["Desktop Firefox"], ...phone, isMobile: false } },
        ]
      : []),
  ],
});
