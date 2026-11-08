/**
 * The restore drill's decisions (plan §10 rec. 5: restore once into a scratch database).
 * Documents are compared as path -> canonical JSON of their fields.
 */
export type Docs = ReadonlyMap<string, string>;

export function compareDocs(source: Docs, restored: Docs): { missing: string[]; extra: string[]; changed: string[] } {
  const missing = [...source.keys()].filter((p) => !restored.has(p)).sort();
  const extra = [...restored.keys()].filter((p) => !source.has(p)).sort();
  const changed = [...source.keys()].filter((p) => restored.has(p) && restored.get(p) !== source.get(p)).sort();
  return { missing, extra, changed };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function drillDatabaseId(kind: "backup" | "pitr", at: Date): string {
  const d = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  return `drill-${kind}-${d}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
}

/** The drill deletes only what it made: a database whose ID starts with drill-. */
export function assertScratch(databaseId: string): void {
  if (!/^drill-(backup|pitr)-\d{8}-\d{4}$/.test(databaseId)) throw new Error(`${databaseId} is not a drill database; refusing to delete it.`);
}

export async function withScratch<T>(databaseId: string, work: () => Promise<T>, drop: (id: string) => Promise<void>): Promise<T> {
  try {
    return await work();
  } finally {
    await drop(databaseId);
  }
}

/** PITR older than an hour reads whole minutes only: the minute at or before, and at or after. */
export function minutesAround(iso: string): [string, string] {
  const t = Date.parse(iso);
  const floor = Math.floor(t / 60_000) * 60_000;
  const ceil = Math.ceil(t / 60_000) * 60_000;
  const fmt = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
  return [fmt(floor), fmt(ceil)];
}
