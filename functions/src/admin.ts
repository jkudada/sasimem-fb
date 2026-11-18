/** The Admin SDK, initialised once. Region and project come from the environment. */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const app = () => getApps()[0] ?? initializeApp();

export const db = (): Firestore => getFirestore(app());
export const auth = (): Auth => getAuth(app());

/**
 * The default bucket. Deployed, FIREBASE_CONFIG names it; against the emulators
 * (T3 starts its own app with only a project ID) it is the project's appspot bucket.
 */
export function bucket() {
  const a = app();
  const name = a.options.storageBucket ?? `${a.options.projectId ?? process.env["GCLOUD_PROJECT"] ?? ""}.appspot.com`;
  return getStorage(a).bucket(name);
}

/**
 * The retention bucket (PLAN-SUBSCRIBERS §11, S6): issued invoices and their PDFs, kept
 * 7 years after a purge by the bucket's lifecycle rule; no client can reach it. Made by
 * ops/retention-bucket.ts; named by RETENTION_BUCKET, else "<project>-retention".
 */
export function retentionBucket(name: string) {
  const a = app();
  return getStorage(a).bucket(name !== "" ? name : `${a.options.projectId ?? process.env["GCLOUD_PROJECT"] ?? ""}-retention`);
}
