import { setGlobalOptions } from "firebase-functions/v2";

// Everything in Sydney, the nearest region to PNG (plan §2); verified in the step-0
// spike. A side-effect module, imported first by index.ts: ES modules evaluate
// imports before the importing file's body, so calling setGlobalOptions in
// index.ts itself ran after the functions were already defined.
setGlobalOptions({ region: "australia-southeast1" });
