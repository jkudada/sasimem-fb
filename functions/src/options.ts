import { setGlobalOptions } from "firebase-functions/v2";

// Everything in Sydney, the nearest region to PNG (plan §2); verified in the step-0
// spike. A side-effect module, imported first by index.ts: ES modules evaluate
// imports before the importing file's body, so calling setGlobalOptions in
// index.ts itself ran after the functions were already defined.
//
// enforceAppCheck: every callable refuses a request without a valid App Check token
// (plan §5), before its own code runs. It applies to callables only: the approval page
// is opened from an email with no JavaScript, and the tick is called by Cloud Scheduler.
setGlobalOptions({ region: "australia-southeast1", enforceAppCheck: true });
