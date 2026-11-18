/**
 * Make the retention bucket a purge copies issued invoices to (PLAN-SUBSCRIBERS §11, S6):
 * "<project>-retention", 7-year lifecycle, no public or client access. Safe to rerun: an
 * existing bucket has its access and lifecycle settings put back.
 *
 *   node ops/retention-bucket.ts --project sasimem-dev [--dry-run]
 *
 * The functions find it by that name; set RETENTION_BUCKET in functions/.env.<project>
 * only to use another.
 */
import { ApiError, call, fail, get } from "./src/gcp.ts";
import { has, projectFrom } from "./src/guard.ts";
import { retentionBucketPatch, retentionBucketSpec } from "./src/retention.ts";

const STORAGE = "https://storage.googleapis.com/storage/v1";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const spec = retentionBucketSpec(project);
  const dry = has(argv, "dry-run");
  let exists = true;
  try {
    await get(`${STORAGE}/b/${spec.name}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
    exists = false;
  }
  if (exists) {
    console.log(`${dry ? "Would update" : "Updating"} gs://${spec.name}: uniform access, public access prevented, delete after ${spec.lifecycle.rule[0]?.condition.age} days`);
    if (!dry) await call({ method: "PATCH", url: `${STORAGE}/b/${spec.name}`, body: retentionBucketPatch(project) });
  } else {
    console.log(`${dry ? "Would create" : "Creating"} gs://${spec.name} in ${spec.location}, ${spec.storageClass}, delete after ${spec.lifecycle.rule[0]?.condition.age} days`);
    if (!dry) await call({ method: "POST", url: `${STORAGE}/b?project=${project}`, body: spec });
  }
  if (!dry) console.log("Done.");
}

main().catch(fail);
