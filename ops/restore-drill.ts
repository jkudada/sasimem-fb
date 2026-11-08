/**
 * The restore drill (plan §10 rec. 5; docs/runbooks/restore.md). Restores into a scratch
 * database, compares it document by document with the source, then deletes it.
 *
 *   node ops/restore-drill.ts --project sasimem-dev                    newest backup
 *   node ops/restore-drill.ts --project sasimem-dev --pitr 2026-11-08T03:07:00Z
 *                                                    a point in time (whole minute, < 7 days)
 *
 * The source is read as it was at the same moment (PITR), so the comparison is exact:
 * for a backup, at the whole minutes either side of its snapshot. Exits 1 on any
 * difference. Never writes to the source; deletes only the drill- database it made.
 */
import { assertScratch, compareDocs, type Docs, drillDatabaseId, minutesAround, withScratch } from "./src/drill.ts";
import { call, fail, get, waitFor, waitUntilGone } from "./src/gcp.ts";
import { flag, projectFrom } from "./src/guard.ts";

const API = "https://firestore.googleapis.com/v1";
const argv = process.argv.slice(2);
const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(0)} s`;

type Value = Record<string, unknown>;
/** Fields with keys sorted at every level, so equal documents give equal strings. */
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
  : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Value)[k])]))
  : v;

/** Every document in a database, optionally as it was at readTime, as path -> fields. */
async function readAll(project: string, database: string, readTime?: string): Promise<Map<string, string>> {
  const root = `projects/${project}/databases/${database}/documents`;
  const at = readTime === undefined ? {} : { readTime };
  const out = new Map<string, string>();
  const walk = async (parent: string): Promise<void> => {
    let pageToken: string | undefined;
    const ids: string[] = [];
    do {
      const page = await call<{ collectionIds?: string[]; nextPageToken?: string }>({ method: "POST", url: `${API}/${parent}:listCollectionIds`, body: { pageSize: 300, ...at, ...(pageToken === undefined ? {} : { pageToken }) } });
      ids.push(...(page.collectionIds ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    for (const id of ids) {
      let token: string | undefined;
      do {
        const q = new URLSearchParams({ pageSize: "300", showMissing: "true", ...at, ...(token === undefined ? {} : { pageToken: token }) });
        const page = await get<{ documents?: { name: string; fields?: Value; createTime?: string }[]; nextPageToken?: string }>(`${API}/${parent}/${id}?${q}`);
        for (const d of page.documents ?? []) {
          // showMissing lists parents that exist only through a subcollection; they hold no fields.
          if (d.createTime !== undefined) out.set(d.name.slice(root.length + 1), JSON.stringify(canonical(d.fields ?? {})));
          await walk(d.name);
        }
        token = page.nextPageToken;
      } while (token !== undefined);
    }
  };
  await walk(root);
  return out;
}

function report(label: string, source: Docs, restored: Docs): boolean {
  const diff = compareDocs(source, restored);
  const same = diff.missing.length + diff.extra.length + diff.changed.length === 0;
  console.log(`  vs source at ${label}: ${source.size} documents; ${same ? "identical" : `missing ${diff.missing.length}, extra ${diff.extra.length}, changed ${diff.changed.length}`}`);
  for (const [kind, paths] of Object.entries(diff)) for (const p of paths.slice(0, 10)) console.log(`    ${kind}: ${p}`);
  return same;
}

async function main() {
  const project = projectFrom(argv);
  const pitr = flag(argv, "pitr");
  const started = Date.now();
  const id = drillDatabaseId(pitr === undefined ? "backup" : "pitr", new Date());
  assertScratch(id);
  const source = await get<{ locationId: string; versionRetentionPeriod: string }>(`${API}/projects/${project}/databases/(default)`);

  let compareAt: string[];
  let op: { name: string };
  if (pitr === undefined) {
    const list = await get<{ backups?: { name: string; database: string; snapshotTime: string; state: string }[] }>(`${API}/projects/${project}/locations/${source.locationId}/backups`);
    const backup = (list.backups ?? []).filter((b) => b.state === "READY" && b.database.endsWith("/databases/(default)")).sort((a, b) => b.snapshotTime.localeCompare(a.snapshotTime))[0];
    if (backup === undefined) throw new Error("No ready backup of (default) to restore.");
    console.log(`Restoring backup of ${backup.snapshotTime} into ${id}`);
    compareAt = [...new Set(minutesAround(backup.snapshotTime))];
    op = await call({ method: "POST", url: `${API}/projects/${project}/databases:restore`, body: { databaseId: id, backup: backup.name } });
  } else {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(\.0+)?Z$/.test(pitr)) throw new Error("--pitr takes a whole minute in UTC, e.g. 2026-11-08T03:07:00Z");
    console.log(`Cloning (default) as it was at ${pitr} into ${id}`);
    compareAt = [pitr];
    op = await call({ method: "POST", url: `${API}/projects/${project}/databases:clone`, body: { databaseId: id, pitrSnapshot: { database: `projects/${project}/databases/(default)`, snapshotTime: pitr } } });
  }

  const drop = async (db: string) => {
    assertScratch(db);
    const t = Date.now();
    // A restore or clone copies the source's delete protection; lift it on the drill's own copy only.
    await waitFor(API, await call({ method: "PATCH", url: `${API}/projects/${project}/databases/${db}?updateMask=deleteProtectionState`, body: { deleteProtectionState: "DELETE_PROTECTION_DISABLED" } }), 2_000, 5 * 60_000);
    // Polling the delete's own operation can hang once the database is gone; wait for the 404.
    await call({ method: "DELETE", url: `${API}/projects/${project}/databases/${db}` });
    await waitUntilGone(`${API}/projects/${project}/databases/${db}`);
    console.log(`Deleted ${db} (${seconds(t)})`);
  };

  // A restore that fails to start leaves nothing to delete; once it has started, the
  // scratch database exists and is deleted whatever the comparison finds.
  const same = await withScratch(id, async () => {
    const t = Date.now();
    await waitFor(API, op, 10_000, 120 * 60_000); // a PITR clone can take many minutes
    console.log(`Restored in ${seconds(t)}`);
    const restored = await readAll(project, id);
    console.log(`Restored database: ${restored.size} documents`);
    for (const at of compareAt) if (report(at, await readAll(project, "(default)", at), restored)) return true;
    return false;
  }, drop);

  console.log(`\n${same ? "PASS" : "FAIL"}: drill finished in ${seconds(started)}`);
  if (!same) process.exit(1);
}

main().catch(fail);
