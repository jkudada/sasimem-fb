/**
 * Firestore and callables, loaded only after sign-in. Writes here are setup data
 * only; anything touching money goes through a callable (plan A5, I9).
 *
 * Firestore Lite (~28 KB gzip) rather than the full SDK (~126-146 KB): nothing in
 * step 2 needs live updates, and the full SDK alone breaks the 160 KB shell budget.
 * The offline cache the plan asks for needs the full SDK - an open question for
 * step 3, when screens start reading.
 */
import { type OrgSetupInput, newTenancyDocument } from "@sasimem/core";
import { collection, connectFirestoreEmulator, doc, getFirestore, writeBatch } from "firebase/firestore/lite";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { app, usingEmulators } from "./firebase.js";
import type { FirstTenancy } from "./screens/TenancyStep.js";

const db = getFirestore(app);
const functions = getFunctions(app, "australia-southeast1");
if (usingEmulators) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export async function createOrg(input: OrgSetupInput): Promise<string> {
  const call = httpsCallable<OrgSetupInput, { orgId: string }>(functions, "createOrg");
  return (await call(input)).data.orgId;
}

/** The first property, tenant and tenancy, in one batch, so nothing is half saved. */
export async function saveFirstTenancy(orgId: string, first: FirstTenancy): Promise<void> {
  const org = `orgs/${orgId}`;
  const propertyRef = doc(collection(db, `${org}/properties`));
  const tenantRef = doc(collection(db, `${org}/tenants`));
  const tenancyRef = doc(collection(db, `${org}/tenancies`));
  const unitId = first.property.units[0]?.id ?? "u1";
  const batch = writeBatch(db);
  batch.set(propertyRef, first.property);
  batch.set(tenantRef, first.tenant);
  batch.set(tenancyRef, newTenancyDocument({ propertyId: propertyRef.id, property: first.property, unitId, tenantId: tenantRef.id, tenant: first.tenant, terms: first.terms }));
  await batch.commit();
}
