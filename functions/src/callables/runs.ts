/**
 * Run callables (plan §6.2). Each re-checks that the caller owns the org, then
 * calls the same store code the tick and the approval page use.
 */
import { type Period, type RunStatus, type Toea, localDate, nextPeriod, parsePeriod, periodLabel, periodOf } from "@sasimem/core";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import type { Mailer } from "../mail/mailer.js";
import { approvalDigest, freshLink } from "../mail/templates.js";
import { draftRun, type OrgDoc, refs } from "../store/runs.js";
import { replaceToken, requestApproval } from "../store/tokens.js";
import { ownerOrg } from "./auth.js";

export interface RunDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  readonly newToken: () => string;
  /** The Hosting origin approval links point at. */
  readonly appUrl: () => string;
}

export interface RunReply {
  readonly status: RunStatus;
  readonly message: string;
}

const linkFor = (deps: RunDeps, token: string) => `${deps.appUrl()}/a/${token}`;

/** The org and period a run callable names. The period must be this month or next, landlord time. */
async function orgAndPeriod(request: CallableRequest<unknown>, now: Date): Promise<{ orgId: string; org: OrgDoc; period: Period }> {
  const orgId = await ownerOrg(request);
  const org = (await refs(orgId).org.get()).data() as OrgDoc;
  let period: Period;
  try {
    period = parsePeriod(String((request.data as { period?: unknown }).period ?? ""));
  } catch {
    throw new HttpsError("invalid-argument", "Choose this month or next.");
  }
  const thisMonth = periodOf(localDate(now, org.timezone));
  if (period !== thisMonth && period !== nextPeriod(thisMonth)) throw new HttpsError("invalid-argument", "Choose this month or next.");
  return { orgId, org, period };
}

/** Email the digest for a run that has just been asked for approval. */
async function sendDigest(deps: RunDeps, orgId: string, org: OrgDoc, period: Period, token: string): Promise<void> {
  const run = (await refs(orgId).run(period).get()).data() ?? {};
  await deps.mailer.send(approvalDigest({
    to: org.email, orgName: org.name, period,
    count: run["invoiceCount"] as number, totalToea: run["totalToea"] as Toea,
    link: linkFor(deps, token), sendAt: (run["sendAt"] as { toDate(): Date }).toDate(), timezone: org.timezone,
  }));
}

const WAITING: Partial<Record<RunStatus, (p: string) => string>> = {
  awaitingApproval: (p) => `${p} is already waiting for your approval. Check your email for the link.`,
  held: (p) => `${p} is held, waiting for your approval. Check your email for the link.`,
  approved: (p) => `${p} is already approved.`,
  sent: (p) => `${p} has already been sent.`,
  cancelled: (p) => `${p} was cancelled.`,
};

export function makeDraftNow(deps: RunDeps) {
  return onCall<{ orgId: string; period: string }, Promise<RunReply>>(async (request) => {
    const now = deps.now();
    const { orgId, org, period } = await orgAndPeriod(request, now);
    const label = periodLabel(period);
    if ((await draftRun(orgId, period, now)) === "nothingToDraft") {
      throw new HttpsError("failed-precondition", `There is nothing to invoice for ${label}: no tenancy is active that month.`);
    }
    const token = deps.newToken();
    const outcome = await requestApproval(orgId, period, now, token);
    if (!outcome.requested) {
      const status = outcome.status ?? "draft";
      return { status, message: WAITING[status]?.(label) ?? `${label} is drafted.` };
    }
    await sendDigest(deps, orgId, org, period, token);
    return { status: "awaitingApproval", message: `Sent you the approval link for ${label}.` };
  });
}

export function makeReissueApproval(deps: RunDeps) {
  return onCall<{ orgId: string; period: string }, Promise<RunReply>>(async (request) => {
    const now = deps.now();
    const { orgId, org, period } = await orgAndPeriod(request, now);
    const token = deps.newToken();
    if (!(await replaceToken(orgId, period, now, token))) {
      throw new HttpsError("failed-precondition", `${periodLabel(period)} is not waiting for approval, so there is no link to replace.`);
    }
    await sendFreshLink(deps, org, period, token);
    return { status: "awaitingApproval", message: `Sent a new approval link to ${org.email}.` };
  });
}

/** Always to the org's address on file (plan §6.1), never one a visitor supplies. */
export async function sendFreshLink(deps: RunDeps, org: OrgDoc, period: Period, token: string): Promise<void> {
  await deps.mailer.send(freshLink({ to: org.email, orgName: org.name, period, link: linkFor(deps, token) }));
}
