import { setGlobalOptions } from "firebase-functions/v2";

// Everything in Sydney, the nearest region to PNG (plan §2); verified in the step-0 spike.
setGlobalOptions({ region: "australia-southeast1" });

export { createOrg } from "./callables/createOrg.js";
