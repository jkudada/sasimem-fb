/**
 * Alerts for the tick (plan §12): a log-based metric counting successful ticks, a policy
 * on any tick error, and one on no success for 3 hours. Safe to rerun: each is updated
 * in place, found by name.
 *
 *   node ops/alerts.ts --project sasimem-dev [--email you@example.com]
 *
 * With --email, the alerts go to that address (an email notification channel).
 */
import { tickDoneMetric, tickFailedPolicy, tickSilentPolicy } from "./src/alerts.ts";
import { ApiError, call, fail, get } from "./src/gcp.ts";
import { flag, projectFrom } from "./src/guard.ts";

const argv = process.argv.slice(2);
const LOGGING = "https://logging.googleapis.com/v2";
const MONITORING = "https://monitoring.googleapis.com/v3";

async function main() {
  const project = projectFrom(argv);
  const email = flag(argv, "email");

  const metric = tickDoneMetric();
  try {
    await get(`${LOGGING}/projects/${project}/metrics/${metric.name}`);
    await call({ method: "PUT", url: `${LOGGING}/projects/${project}/metrics/${metric.name}`, body: metric });
    console.log(`Updated metric ${metric.name}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
    await call({ method: "POST", url: `${LOGGING}/projects/${project}/metrics`, body: metric });
    console.log(`Created metric ${metric.name}`);
  }

  const channels: string[] = [];
  if (email !== undefined) {
    const list = await get<{ notificationChannels?: { name: string; labels?: { email_address?: string } }[] }>(`${MONITORING}/projects/${project}/notificationChannels?filter=${encodeURIComponent('type="email"')}`);
    const found = list.notificationChannels?.find((c) => c.labels?.email_address === email);
    const name = found?.name ?? (await call<{ name: string }>({ method: "POST", url: `${MONITORING}/projects/${project}/notificationChannels`, body: { type: "email", displayName: `Sasimem alerts: ${email}`, labels: { email_address: email } } })).name;
    channels.push(name);
    console.log(`${found === undefined ? "Created" : "Reused"} email channel for ${email}`);
  }

  const existing = await get<{ alertPolicies?: { name: string; displayName: string }[] }>(`${MONITORING}/projects/${project}/alertPolicies`);
  for (const policy of [tickFailedPolicy(project, channels), tickSilentPolicy(project, channels)]) {
    const found = existing.alertPolicies?.find((p) => p.displayName === policy.displayName);
    if (found === undefined) await call({ method: "POST", url: `${MONITORING}/projects/${project}/alertPolicies`, body: policy });
    else await call({ method: "PATCH", url: `${MONITORING}/${found.name}`, body: policy });
    console.log(`${found === undefined ? "Created" : "Updated"} policy "${policy.displayName}"`);
  }
  if (channels.length === 0) console.log("\nNo --email given: the policies open incidents in the console but notify nobody.");
}

main().catch(fail);
