/**
 * The sign-in route on a throttled phone (plan §9.4's Lighthouse budget, measured here):
 * Slow 4G, a 4× slower CPU, an empty cache. Runs in the nightly "throttled phone" project.
 */
import { expect, test } from "./phone.js";

const USABLE_WITHIN_MS = 4_000;
const TRANSFER_BUDGET_BYTES = 100 * 1024;

test("the sign-in form is usable within 4 s, and the route transfers at most 100 KB", async ({ page }) => {
  const started = Date.now();
  await page.goto("/");
  await expect(page.getByLabel(/email/i)).toBeEditable({ timeout: USABLE_WITHIN_MS });
  const usableMs = Date.now() - started;

  await page.waitForLoadState("networkidle");
  const bytes = await page.evaluate(() =>
    (performance.getEntriesByType("navigation") as PerformanceResourceTiming[])
      .concat(performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .reduce((sum, e) => sum + e.transferSize, 0));
  test.info().annotations.push({ type: "sign-in route", description: `usable in ${usableMs} ms, ${(bytes / 1024).toFixed(1)} KB transferred` });
  expect(usableMs).toBeLessThanOrEqual(USABLE_WITHIN_MS);
  expect(bytes).toBeLessThanOrEqual(TRANSFER_BUDGET_BYTES);
});
