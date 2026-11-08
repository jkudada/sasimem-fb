import { expect, test, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import * as functions from "../src/index.js";

type Endpoint = { scheduleTrigger?: { schedule?: string; retryConfig?: { retryCount?: number } }; secretEnvironmentVariables?: { key: string }[] };
const endpoint = (name: keyof typeof functions) => (functions[name] as unknown as { __endpoint: Endpoint }).__endpoint;
const secrets = (name: keyof typeof functions) => (endpoint(name).secretEnvironmentVariables ?? []).map((s) => s.key).sort();

test("the tick runs every hour, and a failed run is retried (plan §6.4)", () => {
  expect(endpoint("tick").scheduleTrigger).toMatchObject({ schedule: "every 60 minutes", retryConfig: { retryCount: 3 } });
});

const MAILERS = ["tick", "draftNow", "reissueApproval", "resendInvoice"] as const;

test("every function that sends email can read both senders' secrets; the approval page also signs its forms", () => {
  for (const name of MAILERS) expect(secrets(name), name).toEqual(["GMAIL_APP_PASSWORD", "RESEND_API_KEY"]);
  expect(secrets("approvalPage")).toEqual(["APPROVAL_SIGNING_KEY", "GMAIL_APP_PASSWORD", "RESEND_API_KEY"]);
});

// The deploy reads the secrets while loading the code, without functions/.env.<project>,
// so MAIL_PROVIDER is not set then. Choosing the secrets by it deployed the wrong one.
test("the secrets declared do not depend on MAIL_PROVIDER, which the deploy does not see", async () => {
  vi.resetModules();
  vi.stubEnv("MAIL_PROVIDER", "gmail");
  try {
    const gmail = await import("../src/index.js");
    const keys = (f: unknown) => ((f as { __endpoint: Endpoint }).__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key).sort();
    for (const name of [...MAILERS, "approvalPage"] as const) expect(keys(gmail[name]), name).toEqual(secrets(name));
  } finally {
    vi.unstubAllEnvs();
  }
});

type Handler = ((req: express.Request, res: express.Response) => unknown) & { __endpoint: { callableTrigger?: object } };
const callables = Object.entries(functions).filter(([, f]) => (f as unknown as Handler).__endpoint.callableTrigger !== undefined);

/** Call a callable over real HTTP, as the client SDK would, with no auth and no App Check token. */
async function callBare(handler: Handler): Promise<{ status: number; message: string }> {
  const app = express();
  app.use(express.json());
  app.post("/", (req, res) => void handler(req, res));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }) });
    const body = (await res.json()) as { error?: { message?: string } };
    return { status: res.status, message: body.error?.message ?? "" };
  } finally {
    server.close();
  }
}

test("every callable refuses a call with no App Check token before its own code runs (plan §5)", async () => {
  expect(callables.length).toBeGreaterThanOrEqual(15);
  for (const [name, handler] of callables) {
    // The SDK's own refusal says "Unauthenticated"; a callable's code would say "Sign in first."
    expect(await callBare(handler as unknown as Handler), name).toEqual({ status: 401, message: "Unauthenticated" });
  }
});
