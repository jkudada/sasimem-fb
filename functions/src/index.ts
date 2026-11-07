import "./options.js"; // must stay first: see options.ts

import { makeDraftNow, makeReissueApproval } from "./callables/runs.js";
import { makeApprovalPage } from "./http/index.js";
import { newToken } from "./links.js";
import { db } from "./admin.js";
import { OutboxMailer } from "./mail/mailer.js";
import { ResendMailer } from "./mail/resend.js";
import { APP_URL, APPROVAL_SIGNING_KEY, MAIL_FROM, RESEND_API_KEY } from "./params.js";
import { makeTick } from "./tick.js";
import { makePaymentCallables } from "./callables/payments.js";

export { createOrg } from "./callables/createOrg.js";
export { onPropertyUpdated, onTenantUpdated } from "./triggers/syncTenancyCopies.js";
export { getNumbering, setNextInvoiceNumber } from "./callables/numbering.js";
export { approveRunCallable as approveRun, exclude, include, rebuildRun, setRent } from "./callables/edits.js";

// Deployed, mail goes through Resend. The emulator never sends real mail: it prints each
// message and drops it in _outbox, so the T4 journeys can follow links.
const mailer = process.env["FUNCTIONS_EMULATOR"] === "true"
  ? new OutboxMailer(() => db().collection("_outbox"))
  : new ResendMailer({ apiKey: () => RESEND_API_KEY.value(), from: () => MAIL_FROM.value() });
const deps = { now: () => new Date(), mailer, newToken, appUrl: () => APP_URL.value() };
export const draftNow = makeDraftNow(deps);
export const reissueApproval = makeReissueApproval(deps);
export const approvalPage = makeApprovalPage({ ...deps, signingKey: () => APPROVAL_SIGNING_KEY.value() });
export const tick = makeTick(deps);

const payments = makePaymentCallables(deps);
export const markPaid = payments.markPaid;
export const markUnpaid = payments.markUnpaid;
export const pauseReminders = payments.pauseReminders;
export const voidInvoice = payments.voidInvoice;
export const invoicePdf = payments.invoicePdf;
export const resendInvoice = payments.resendInvoice;
export const exportCsv = payments.exportCsv;
