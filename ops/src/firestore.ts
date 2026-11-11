/** Firestore over REST, for the ops scripts (no Admin SDK in ops/). Thin: decisions live in subscribers.ts. */
import { call, get } from "./gcp.ts";
import { documentsRoot, type Write } from "./subscribers.ts";

const API = "https://firestore.googleapis.com/v1";

interface RestDoc { name: string; fields?: Record<string, { stringValue?: string; nullValue?: null }> }

/** Every document in a collection (`orgs`, `orgs/x/tenancies`), only the masked fields, all pages. */
export async function listDocuments(project: string, collection: string, mask: readonly string[]): Promise<RestDoc[]> {
  const docs: RestDoc[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "300", ...(pageToken === "" ? {} : { pageToken }) });
    for (const field of mask) params.append("mask.fieldPaths", field);
    const page = await get<{ documents?: RestDoc[]; nextPageToken?: string }>(`${API}/${documentsRoot(project)}/${collection}?${params}`);
    docs.push(...(page.documents ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken !== "");
  return docs;
}

export const idOf = (doc: RestDoc): string => doc.name.slice(doc.name.lastIndexOf("/") + 1);

/** Commit writes in batches of 500 (Firestore's limit); each batch is atomic. */
export async function commit(project: string, writes: readonly Write[]): Promise<void> {
  for (let i = 0; i < writes.length; i += 500) {
    await call({ method: "POST", url: `${API}/${documentsRoot(project)}:commit`, body: { writes: writes.slice(i, i + 500) } });
  }
}
