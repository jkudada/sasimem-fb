/**
 * Keeping each tenancy's copies of its tenant and property true (plan §4). Only
 * this code writes those fields after a tenancy is created; the rules stop the
 * browser changing them.
 */
import { type PropertyInput, type TenancyCopies, type TenantInput, tenancyCopies } from "@sasimem/core";
import type { DocumentData } from "firebase-admin/firestore";
import { db } from "../admin.js";

export type CopySource = { readonly tenantId: string } | { readonly propertyId: string };

/** Rewrite the copies on every tenancy of one tenant or property. Writes only what changed. */
export async function syncCopies(orgId: string, source: CopySource): Promise<number> {
  const org = db().doc(`orgs/${orgId}`);
  const [field, id] = "tenantId" in source ? ["tenantId", source.tenantId] : ["propertyId", source.propertyId];
  const tenancies = await org.collection("tenancies").where(field, "==", id).get();
  if (tenancies.empty) return 0;

  // Each tenant and property is read once, however many tenancies share it.
  const cache = new Map<string, Promise<DocumentData | undefined>>();
  const read = (collection: "tenants" | "properties", docId: string) => {
    const key = `${collection}/${docId}`;
    let doc = cache.get(key);
    if (doc === undefined) cache.set(key, (doc = org.collection(collection).doc(docId).get().then((d) => d.data())));
    return doc;
  };

  const batch = db().batch();
  let changed = 0;
  for (const t of tenancies.docs) {
    const tenancy = t.data();
    const [tenant, property] = await Promise.all([read("tenants", tenancy["tenantId"]), read("properties", tenancy["propertyId"])]);
    // A deleted tenant or property leaves the tenancy's last copies alone (core.deleteProblem keeps that rare).
    if (tenant === undefined || property === undefined) continue;
    const copies = tenancyCopies({ unitId: tenancy["unitId"], unitLabel: tenancy["unitLabel"] }, property as PropertyInput, tenant as TenantInput);
    const differs = (Object.keys(copies) as (keyof TenancyCopies)[]).some((k) => tenancy[k] !== copies[k]);
    if (!differs) continue;
    batch.update(t.ref, { ...copies });
    changed++;
  }
  if (changed > 0) await batch.commit(); // ≤ 20 tenancies per landlord: one batch is plenty
  return changed;
}
