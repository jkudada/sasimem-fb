import { describe, expect, test } from "vitest";
import { appCheckDomains, enforceRequests, recaptchaKeyRequest, registerRequest, siteKeyOf } from "../src/appcheck.ts";

describe("turning App Check on for a project (plan §5)", () => {
  test("the app's domains: Hosting's two, plus any custom domain", () => {
    expect(appCheckDomains("sasimem-dev", [])).toEqual(["sasimem-dev.web.app", "sasimem-dev.firebaseapp.com"]);
    expect(appCheckDomains("sasimem-prod", ["app.sasimem.example"])).toEqual(["sasimem-prod.web.app", "sasimem-prod.firebaseapp.com", "app.sasimem.example"]);
  });

  test("a score-based reCAPTCHA Enterprise key, limited to those domains", () => {
    expect(recaptchaKeyRequest("sasimem-dev", ["sasimem-dev.web.app"])).toEqual({
      method: "POST",
      url: "https://recaptchaenterprise.googleapis.com/v1/projects/sasimem-dev/keys",
      body: { displayName: "Sasimem web", webSettings: { allowedDomains: ["sasimem-dev.web.app"], allowAllDomains: false, integrationType: "SCORE" } },
    });
    expect(siteKeyOf("projects/sasimem-dev/keys/6LcAbC")).toBe("6LcAbC");
  });

  test("the key is registered for the web app, with hour-long tokens", () => {
    expect(registerRequest("sasimem-dev", "1:123:web:abc", "6LcAbC")).toEqual({
      method: "PATCH",
      url: "https://firebaseappcheck.googleapis.com/v1/projects/sasimem-dev/apps/1:123:web:abc/recaptchaEnterpriseConfig?updateMask=siteKey,tokenTtl",
      body: { siteKey: "6LcAbC", tokenTtl: "3600s" },
    });
  });

  test("Firestore and Storage are enforced; callables enforce it in code", () => {
    expect(enforceRequests("sasimem-dev")).toEqual(
      ["firestore.googleapis.com", "firebasestorage.googleapis.com"].map((service) => ({
        method: "PATCH",
        url: `https://firebaseappcheck.googleapis.com/v1/projects/sasimem-dev/services/${service}?updateMask=enforcementMode`,
        body: { enforcementMode: "ENFORCED" },
      })),
    );
  });
});
