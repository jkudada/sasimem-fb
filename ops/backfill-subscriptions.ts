/**
 * Give every org that has no subscription a free one for good (PLAN-SUBSCRIBERS D6), with a
 * limit no lower than the tenancies it already has. Run it BEFORE deploying the rules that
 * check the tenancy limit: without a subscription, an org cannot add a tenancy.
 * Safe to run twice: each write is create-only.
 *
 *   node ops/backfill-subscriptions.ts --project sasimem-dev [--dry-run]
 */
import { fail } from "./src/gcp.ts";
import { commit, idOf, listDocuments } from "./src/firestore.ts";
import { has, projectFrom } from "./src/guard.ts";
import { backfillWrites, type OrgTenancies } from "./src/subscribers.ts";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const have = new Set((await listDocuments(project, "subscriptions", ["status"])).map(idOf));
  const orgs: OrgTenancies[] = [];
  for (const org of await listDocuments(project, "orgs", ["name"])) {
    const id = idOf(org);
    if (have.has(id)) continue;
    const tenancies = await listDocuments(project, `orgs/${id}/tenancies`, ["endDate"]);
    orgs.push({ id, tenancyEndDates: tenancies.map((t) => t.fields?.["endDate"]?.stringValue ?? null) });
  }
  const writes = backfillWrites(project, orgs, have, new Date());
  for (const w of writes) {
    const f = w.update.fields;
    const count = "integerValue" in (f["activeTenancyCount"] ?? {}) ? (f["activeTenancyCount"] as { integerValue: string }).integerValue : "?";
    const limit = "integerValue" in (f["tenancyLimit"] ?? {}) ? (f["tenancyLimit"] as { integerValue: string }).integerValue : "?";
    console.log(`${has(argv, "dry-run") ? "Would give" : "Giving"} ${w.update.name.split("/documents/")[1]} a free subscription: ${count} tenancies, limit ${limit}`);
  }
  console.log(`${have.size} org(s) already had a subscription.`);
  if (writes.length > 0 && !has(argv, "dry-run")) await commit(project, writes);
}

main().catch(fail);
