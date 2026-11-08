/** Keep the tenancy count the limit rule reads (PLAN-SUBSCRIBERS §6). */
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { recountTenancies } from "../store/subscriptions.js";

export function makeOnTenancyWritten(deps: { readonly now: () => Date }) {
  // Any create, edit (an end date) or delete: recount from what is there now.
  return onDocumentWritten("orgs/{orgId}/tenancies/{tenancyId}", async (event) => {
    await recountTenancies(event.params.orgId, deps.now());
  });
}

export const onTenancyWritten = makeOnTenancyWritten({ now: () => new Date() });
