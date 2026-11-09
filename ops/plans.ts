/**
 * Seed the subscription plans (PLAN-SUBSCRIBERS §3) into plans/{id}. Writes only the plans
 * that are missing: a plan already there keeps its prices, which may have been changed on purpose.
 *
 *   node ops/plans.ts --project sasimem-dev [--dry-run]
 */
import { fail } from "./src/gcp.ts";
import { commit, idOf, listDocuments } from "./src/firestore.ts";
import { has, projectFrom } from "./src/guard.ts";
import { planWrites } from "./src/subscribers.ts";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const existing = new Set((await listDocuments(project, "plans", ["name"])).map(idOf));
  const writes = planWrites(project, existing);
  for (const w of writes) console.log(`${has(argv, "dry-run") ? "Would create" : "Creating"} ${w.update.name.split("/documents/")[1]}`);
  if (existing.size > 0) console.log(`Left as they are: ${[...existing].map((id) => `plans/${id}`).join(", ")}`);
  if (writes.length === 0) console.log("Nothing to do.");
  else if (!has(argv, "dry-run")) await commit(project, writes);
}

main().catch(fail);
