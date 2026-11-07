import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

/** Every number in a value that is not a whole number, as "path: value". */
function floatsIn(value: unknown, path: string): string[] {
  if (typeof value === "number") return Number.isInteger(value) ? [] : [`${path}: ${value}`];
  if (value === null || typeof value !== "object" || value instanceof Timestamp) return [];
  return Object.entries(value).flatMap(([k, v]) => floatsIn(v, `${path}.${k}`));
}

/** Walk a document and all its subcollections, returning every float found (I7). */
export async function floatsUnder(db: Firestore, docPath: string): Promise<string[]> {
  const walk = async (ref: DocumentReference): Promise<string[]> => {
    const snap = await ref.get();
    const here = snap.exists ? floatsIn(snap.data(), ref.path) : [];
    const children = await Promise.all(
      (await ref.listCollections()).map(async (c) => (await Promise.all((await c.listDocuments()).map(walk))).flat()),
    );
    return [...here, ...children.flat()];
  };
  return walk(db.doc(docPath));
}
