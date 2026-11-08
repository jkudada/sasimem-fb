/**
 * Google REST calls with Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS,
 * or `gcloud auth application-default login`). Thin on purpose: the decisions are in the other src/ files.
 */
import { GoogleAuth } from "google-auth-library";
import type { ApiRequest } from "./appcheck.ts";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function call<T = Record<string, unknown>>(req: ApiRequest): Promise<T> {
  const client = await auth.getClient();
  const res = await client.request<T>({ method: req.method, url: req.url, ...(req.body === undefined ? {} : { data: req.body }), validateStatus: () => true, timeout: 60_000 });
  if (res.status >= 300) {
    const message = (res.data as { error?: { message?: string } } | undefined)?.error?.message ?? JSON.stringify(res.data);
    throw new ApiError(res.status, `${req.method} ${req.url.split("?")[0]} -> ${res.status}: ${message}`);
  }
  return res.data;
}

export const get = <T = Record<string, unknown>>(url: string) => call<T>({ method: "GET", url });

/**
 * Wait for a long-running operation; `base` is the API root its name is relative to.
 * Gives up after `deadlineMs`, printing the time waited each minute meanwhile.
 */
export async function waitFor(base: string, op: { name: string; done?: boolean; error?: { message: string } }, everyMs = 5_000, deadlineMs = 30 * 60_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  let lastNote = started;
  let current: { name: string; done?: boolean; error?: { message: string }; response?: Record<string, unknown> } = op;
  while (current.done !== true) {
    if (Date.now() - started > deadlineMs) throw new Error(`${op.name} not done after ${deadlineMs / 60_000} min; it may still finish on its own.`);
    await new Promise((r) => setTimeout(r, everyMs));
    current = await get(`${base}/${current.name}`);
    if (Date.now() - lastNote >= 60_000) {
      lastNote = Date.now();
      console.log(`  ... still waiting (${Math.round((lastNote - started) / 60_000)} min)`);
    }
  }
  if (current.error !== undefined) throw new Error(`${op.name} failed: ${current.error.message}`);
  return current.response ?? {};
}

/** Wait until a GET of `url` answers 404: the resource is gone. */
export async function waitUntilGone(url: string, everyMs = 5_000, deadlineMs = 10 * 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      await get(url);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return;
      throw e;
    }
    if (Date.now() - started > deadlineMs) throw new Error(`${url} still exists after ${deadlineMs / 60_000} min.`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export function fail(e: unknown): never {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
