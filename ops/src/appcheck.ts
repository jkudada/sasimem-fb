/** The requests that turn App Check on for a project (plan §5). Pure: ops/app-check.ts sends them. */
export interface ApiRequest { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string; body?: object }

const RECAPTCHA = "https://recaptchaenterprise.googleapis.com/v1";
const APP_CHECK = "https://firebaseappcheck.googleapis.com/v1";
export const KEY_NAME = "Sasimem web";

export const appCheckDomains = (project: string, custom: readonly string[]): string[] =>
  [`${project}.web.app`, `${project}.firebaseapp.com`, ...custom];

export const recaptchaKeyRequest = (project: string, domains: readonly string[]): ApiRequest => ({
  method: "POST",
  url: `${RECAPTCHA}/projects/${project}/keys`,
  body: { displayName: KEY_NAME, webSettings: { allowedDomains: [...domains], allowAllDomains: false, integrationType: "SCORE" } },
});

export const siteKeyOf = (keyName: string): string => keyName.split("/").pop() ?? "";

export const registerRequest = (project: string, appId: string, siteKey: string): ApiRequest => ({
  method: "PATCH",
  url: `${APP_CHECK}/projects/${project}/apps/${appId}/recaptchaEnterpriseConfig?updateMask=siteKey,tokenTtl`,
  body: { siteKey, tokenTtl: "3600s" },
});

/** Callables are not here: they enforce App Check in code (functions/src/options.ts). */
export const enforceRequests = (project: string): ApiRequest[] =>
  ["firestore.googleapis.com", "firebasestorage.googleapis.com"].map((service) => ({
    method: "PATCH",
    url: `${APP_CHECK}/projects/${project}/services/${service}?updateMask=enforcementMode`,
    body: { enforcementMode: "ENFORCED" },
  }));
