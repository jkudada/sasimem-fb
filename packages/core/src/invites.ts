/**
 * Invitations to sign up (docs/PLAN-TEMPLATES.md §7, extended by PLAN-SUBSCRIBERS S3):
 * an operator invites an email with a plan, a trial length and an expiry. The console
 * and the `invite` callable read requests with the same function; createOrg reads the
 * stored invitation's terms with `inviteTermsFrom`.
 */
import { type PlanId, TRIAL_DAYS, TRIAL_PLAN } from "./subscriptions.js";

export const INVITE_DAYS = 30;
export const MAX_INVITE_DAYS = 90;
export const MAX_TRIAL_DAYS = 365;

export interface InviteTerms {
  readonly planId: PlanId;
  /** 0 for free. */
  readonly trialDays: number;
}

export type InviteRequest =
  | { readonly kind: "send"; readonly email: string; readonly planId: PlanId; readonly trialDays: number; readonly expiresInDays: number }
  | { readonly kind: "revoke"; readonly email: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLAN_IDS: readonly PlanId[] = ["free", "standard", "plus"];
const wholeIn = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** An invitation's document ID, and the address it is for: the email, trimmed, lower-case. */
export const inviteEmailId = (email: string): string => email.trim().toLowerCase();

export function inviteRequestFrom(data: unknown): InviteRequest | { readonly problem: string } {
  const o = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (o["kind"] !== "send" && o["kind"] !== "revoke") return { problem: "That invitation could not be read. Reload the page and try again." };
  const email = inviteEmailId(typeof o["email"] === "string" ? o["email"] : "");
  if (!EMAIL.test(email)) return { problem: "Enter the email address to invite, like name@example.com." };
  if (o["kind"] === "revoke") return { kind: "revoke", email };
  const planId = o["planId"] as PlanId;
  if (!PLAN_IDS.includes(planId)) return { problem: "Choose Free, Standard or Plus." };
  if (planId !== "free" && !wholeIn(o["trialDays"], 1, MAX_TRIAL_DAYS)) return { problem: `A trial is 1 to ${MAX_TRIAL_DAYS} days.` };
  if (!wholeIn(o["expiresInDays"], 1, MAX_INVITE_DAYS)) return { problem: `An invitation lasts 1 to ${MAX_INVITE_DAYS} days.` };
  return { kind: "send", email, planId, trialDays: planId === "free" ? 0 : (o["trialDays"] as number), expiresInDays: o["expiresInDays"] as number };
}

/** The terms a stored invitation gives; one from before plans (or a damaged one) gives the standard trial. */
export function inviteTermsFrom(data: Record<string, unknown>): InviteTerms {
  const planId = data["planId"] as PlanId;
  if (planId === "free") return { planId, trialDays: 0 };
  if (PLAN_IDS.includes(planId) && wholeIn(data["trialDays"], 1, MAX_TRIAL_DAYS)) return { planId, trialDays: data["trialDays"] as number };
  return { planId: TRIAL_PLAN, trialDays: TRIAL_DAYS };
}
