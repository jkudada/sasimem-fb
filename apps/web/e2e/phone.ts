/**
 * The test object every T4 spec uses. With `throttled` on (the nightly "throttled phone"
 * project), each page gets Slow 4G and a CPU four times slower, through Chromium's
 * DevTools protocol: the numbers Lighthouse uses for a mobile run (plan §9.4).
 */
import { test as base } from "@playwright/test";

export const SLOW_4G = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
export const CPU_SLOWDOWN = 4;

export const test = base.extend<{ throttled: boolean }>({
  throttled: [false, { option: true }],
  page: async ({ page, throttled }, use) => {
    if (throttled) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
    }
    await use(page);
  },
});

export { expect } from "@playwright/test";
