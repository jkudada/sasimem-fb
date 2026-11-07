import "./options.js"; // must stay first: see options.ts

import { makeDraftNow, makeReissueApproval } from "./callables/runs.js";
import { makeApprovalPage } from "./http/index.js";
import { newToken } from "./links.js";
import { db } from "./admin.js";
import { ConsoleMailer, OutboxMailer } from "./mail/mailer.js";
import { APP_URL, APPROVAL_SIGNING_KEY } from "./params.js";

export { createOrg } from "./callables/createOrg.js";
export { onPropertyUpdated, onTenantUpdated } from "./triggers/syncTenancyCopies.js";
export { getNumbering, setNextInvoiceNumber } from "./callables/numbering.js";
export { approveRunCallable as approveRun, exclude, include, rebuildRun, setRent } from "./callables/edits.js";

// Step 4 mails through the console; the Resend adapter replaces it in step 5. Under the
// emulator, mail also lands in _outbox so the T4 journeys can follow links.
const mailer = process.env["FUNCTIONS_EMULATOR"] === "true" ? new OutboxMailer(() => db().collection("_outbox")) : new ConsoleMailer();
const deps = { now: () => new Date(), mailer, newToken, appUrl: () => APP_URL.value() };
export const draftNow = makeDraftNow(deps);
export const reissueApproval = makeReissueApproval(deps);
export const approvalPage = makeApprovalPage({ ...deps, signingKey: () => APPROVAL_SIGNING_KEY.value() });
