/**
 * The console's changes (PLAN-SUBSCRIBERS S3): the `operatorAction` and `invite`
 * callables. Loaded on first use, after the data (which starts App Check: every callable
 * enforces it). Each resolves to the server's plain-English refusal, or null.
 */
import { getFunctions, httpsCallable } from "firebase/functions";
import "./data.js"; // starts App Check before the first call
import { app } from "./firebase.js";

const functions = getFunctions(app, "australia-southeast1");
const OFFLINE = "That did not go through. Check the connection and try again.";

/** The server's words for a refusal; a generic line for anything it did not explain. */
export function problemOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const explained = typeof code === "string" && code.startsWith("functions/")
    && !["functions/internal", "functions/unavailable", "functions/deadline-exceeded", "functions/unknown"].includes(code);
  return explained && e instanceof Error ? e.message : OFFLINE;
}

async function call(name: string, data: unknown): Promise<string | null> {
  try {
    await httpsCallable(functions, name)(data);
    return null;
  } catch (e) {
    return problemOf(e);
  }
}

export const operate = (orgId: string, action: unknown): Promise<string | null> => call("operatorAction", { orgId, action });
export const invite = (request: unknown): Promise<string | null> => call("invite", request);
