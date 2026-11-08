/**
 * Turn App Check on for a project (plan §5): a reCAPTCHA Enterprise key for the web
 * app's domains, registered with App Check, and enforcement on Firestore and Storage.
 * Callables already refuse calls without a token (functions/src/options.ts).
 *
 *   node ops/app-check.ts --project sasimem-dev [--domain app.example.com]... [--monitor-only]
 *
 * Prints the site key: build the app with VITE_RECAPTCHA_SITE_KEY set to it.
 * Safe to rerun: an existing "Sasimem web" key is reused.
 */
import { appCheckDomains, enforceRequests, KEY_NAME, recaptchaKeyRequest, registerRequest, siteKeyOf } from "./src/appcheck.ts";
import { call, fail, get, waitFor } from "./src/gcp.ts";
import { has, projectFrom } from "./src/guard.ts";

const argv = process.argv.slice(2);

async function main() {
  const project = projectFrom(argv);
  const custom = argv.flatMap((a, i) => (a === "--domain" && argv[i + 1] !== undefined ? [argv[i + 1] as string] : []));

  const apps = await get<{ apps?: { appId: string; displayName?: string }[] }>(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`);
  const app = apps.apps?.[0];
  if (app === undefined) throw new Error(`${project} has no web app. Create one first: firebase apps:create web sasimem-web --project ${project}`);
  console.log(`Web app: ${app.appId}`);

  for (const service of ["recaptchaenterprise.googleapis.com", "firebaseappcheck.googleapis.com"]) {
    const op = await call<{ name: string; done?: boolean }>({ method: "POST", url: `https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}:enable` });
    await waitFor("https://serviceusage.googleapis.com/v1", op, 3_000);
    console.log(`Enabled ${service}`);
  }

  const keys = await get<{ keys?: { name: string; displayName: string }[] }>(`https://recaptchaenterprise.googleapis.com/v1/projects/${project}/keys`);
  const existing = keys.keys?.find((k) => k.displayName === KEY_NAME);
  const domains = appCheckDomains(project, custom);
  const keyName = existing?.name ?? (await call<{ name: string }>(recaptchaKeyRequest(project, domains))).name;
  if (existing !== undefined) {
    await call({ method: "PATCH", url: `https://recaptchaenterprise.googleapis.com/v1/${keyName}?updateMask=webSettings.allowedDomains`, body: { webSettings: { allowedDomains: domains } } });
  }
  const siteKey = siteKeyOf(keyName);
  console.log(`${existing === undefined ? "Created" : "Reused"} reCAPTCHA Enterprise key ${siteKey} for ${domains.join(", ")}`);

  await call(registerRequest(project, app.appId, siteKey));
  console.log("Registered the key with App Check");

  if (has(argv, "monitor-only")) console.log("Firestore and Storage left unenforced (--monitor-only): watch the App Check metrics first.");
  else for (const req of enforceRequests(project)) {
    await call(req);
    console.log(`Enforced: ${req.url.split("/services/")[1]?.split("?")[0]}`);
  }

  console.log(`\nBuild the app with VITE_RECAPTCHA_SITE_KEY=${siteKey}`);
}

main().catch(fail);
