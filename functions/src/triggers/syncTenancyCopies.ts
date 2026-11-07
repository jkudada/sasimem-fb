/** Triggers that keep tenancy copies true when a tenant or property is edited (plan §4). */
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { syncCopies } from "../store/tenancies.js";

// The documents are re-read rather than taken from the event, so a late or retried
// event writes what is true now, not what was true when it fired.
export const onTenantUpdated = onDocumentUpdated("orgs/{orgId}/tenants/{tenantId}", async (event) => {
  await syncCopies(event.params.orgId, { tenantId: event.params.tenantId });
});

export const onPropertyUpdated = onDocumentUpdated("orgs/{orgId}/properties/{propertyId}", async (event) => {
  await syncCopies(event.params.orgId, { propertyId: event.params.propertyId });
});
