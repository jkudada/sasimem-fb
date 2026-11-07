import { expect, test } from "vitest";
import * as functions from "../src/index.js";

type Endpoint = { scheduleTrigger?: { schedule?: string; retryConfig?: { retryCount?: number } }; secretEnvironmentVariables?: { key: string }[] };
const endpoint = (name: keyof typeof functions) => (functions[name] as unknown as { __endpoint: Endpoint }).__endpoint;
const secrets = (name: keyof typeof functions) => (endpoint(name).secretEnvironmentVariables ?? []).map((s) => s.key).sort();

test("the tick runs every hour, and a failed run is retried (plan §6.4)", () => {
  expect(endpoint("tick").scheduleTrigger).toMatchObject({ schedule: "every 60 minutes", retryConfig: { retryCount: 3 } });
});

test("every function that sends email can read the Resend key; the approval page also signs its forms", () => {
  for (const name of ["tick", "draftNow", "reissueApproval", "resendInvoice"] as const) expect(secrets(name), name).toEqual(["RESEND_API_KEY"]);
  expect(secrets("approvalPage")).toEqual(["APPROVAL_SIGNING_KEY", "RESEND_API_KEY"]);
});
