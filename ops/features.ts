/**
 * Set which features an org has (docs/PLAN-GENERAL-INVOICING.md §3). Until pricing (G5)
 * this is how an org gets one-off invoices. Name every feature it should have: the list
 * replaces what is there, so leaving out rentals,repeating switches the Rentals part off.
 *
 *   node ops/features.ts --project sasimem-dev --org <orgId> --on rentals,repeating,oneOff [--dry-run]
 */
import { fail } from "./src/gcp.ts";
import { featureMap, featuresWrite, RENTALS_TODAY } from "./src/features.ts";
import { commit } from "./src/firestore.ts";
import { flag, has, projectFrom } from "./src/guard.ts";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const orgId = flag(argv, "org") ?? "";
  const features = featureMap(flag(argv, "on") ?? "");
  const on = Object.entries(features).filter(([, v]) => v).map(([k]) => k);
  const off = Object.entries(features).filter(([, v]) => !v).map(([k]) => k);
  const write = featuresWrite(project, orgId, features);
  console.log(`${has(argv, "dry-run") ? "Would set" : "Setting"} orgs/${orgId}.features in ${project}:\n  on:  ${on.join(", ")}\n  off: ${off.join(", ")}`);
  const lost = RENTALS_TODAY.filter((f) => !features[f]);
  if (lost.length > 0) console.log(`Note: ${lost.join(" and ")} will be off, so this org's rent invoicing stops.`);
  if (!has(argv, "dry-run")) await commit(project, [write]);
}

main().catch(fail);
