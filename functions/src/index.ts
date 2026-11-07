import "./options.js"; // must stay first: see options.ts

import { makeDraftNow, makeReissueApproval } from "./callables/runs.js";
import { makeApprovalPage } from "./http/index.js";
import { newToken } from "./links.js";
import { ConsoleMailer } from "./mail/mailer.js";
import { APP_URL, APPROVAL_SIGNING_KEY } from "./params.js";

export { createOrg } from "./callables/createOrg.js";
export { onPropertyUpdated, onTenantUpdated } from "./triggers/syncTenancyCopies.js";
export { getNumbering, setNextInvoiceNumber } from "./callables/numbering.js";
export { approveRunCallable as approveRun, exclude, include, rebuildRun, setRent } from "./callables/edits.js";

// Step 4 mails through the console everywhere; the Resend adapter replaces it in step 5.
const deps = { now: () => new Date(), mailer: new ConsoleMailer(), newToken, appUrl: () => APP_URL.value() };
export const draftNow = makeDraftNow(deps);
export const reissueApproval = makeReissueApproval(deps);
export const approvalPage = makeApprovalPage({ ...deps, signingKey: () => APPROVAL_SIGNING_KEY.value() });
