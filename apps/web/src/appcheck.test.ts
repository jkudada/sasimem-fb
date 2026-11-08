import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appCheckSetup, placeholderToken } from "./appcheck.js";

describe("which App Check provider the app uses (plan §5)", () => {
  test("against the emulators: a placeholder token, since the Functions emulator decodes but never verifies it", () => {
    expect(appCheckSetup({ usingEmulators: true, siteKey: undefined })).toEqual({ kind: "placeholder" });
  });

  test("a real build: reCAPTCHA Enterprise with the site key it was built with", () => {
    expect(appCheckSetup({ usingEmulators: false, siteKey: "6Lc-key" })).toEqual({ kind: "recaptcha", siteKey: "6Lc-key" });
  });

  test("a real build without a site key fails at start, rather than running unprotected and refused", () => {
    expect(() => appCheckSetup({ usingEmulators: false, siteKey: undefined })).toThrow("VITE_RECAPTCHA_SITE_KEY");
    expect(() => appCheckSetup({ usingEmulators: false, siteKey: " " })).toThrow("VITE_RECAPTCHA_SITE_KEY");
  });

  test("the placeholder is a JWT naming the app, live for an hour", () => {
    const now = Date.UTC(2026, 10, 8, 3, 0, 0);
    const { token, expireTimeMillis } = placeholderToken("1:demo:web:sasimem", now);
    const [, payload] = token.split(".");
    expect(token.split(".")).toHaveLength(3);
    expect(JSON.parse(atob((payload ?? "").replace(/-/g, "+").replace(/_/g, "/")))).toMatchObject({ sub: "1:demo:web:sasimem", exp: now / 1000 + 3600 });
    expect(expireTimeMillis).toBe(now + 3_600_000);
  });
});

describe("the data layer", () => {
  const order: string[] = [];

  // Loading data.ts (and core) takes seconds cold, so it happens here, not in the test.
  beforeAll(async () => {
    vi.resetModules(); // appcheck.js was loaded above with the real SDK
    vi.doMock("./firebase.js", () => ({ app: { options: { appId: "1:demo:web:sasimem" } }, usingEmulators: true }));
    vi.doMock("firebase/app-check", () => ({
      initializeAppCheck: () => void order.push("appCheck"),
      CustomProvider: class { constructor(readonly o: unknown) {} },
      ReCaptchaEnterpriseProvider: class { constructor(readonly k: string) {} },
    }));
    vi.doMock("firebase/firestore/lite", () => ({ getFirestore: () => void order.push("firestore"), connectFirestoreEmulator: () => undefined, collection: vi.fn(), doc: vi.fn(), writeBatch: vi.fn() }));
    vi.doMock("firebase/functions", () => ({ getFunctions: () => void order.push("functions"), connectFunctionsEmulator: () => undefined, httpsCallable: vi.fn() }));
    await import("./data.js");
  });
  afterAll(() => {
    for (const m of ["./firebase.js", "firebase/app-check", "firebase/firestore/lite", "firebase/functions"]) vi.doUnmock(m);
  });

  test("starts App Check before its first Firestore or Functions use", () => {
    expect(order).toEqual(["appCheck", "firestore", "functions"]);
  });
});
