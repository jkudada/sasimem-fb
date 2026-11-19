/**
 * Staff management and the console's settings (docs/PLAN-ADMIN-DASHBOARD.md §5, §9, A1).
 * `manageStaff` lists, invites, re-invites, changes roles, suspends, reactivates, removes
 * and resets the code of staff, and signs the caller out everywhere; `updateSettings`
 * changes the Owner's and Managers' switches. Core's staff.ts decides who may; store/staff.ts
 * writes the record and its audit entry together; then Auth is brought into line (the
 * `staffRole` claim the console reads to choose its pages, refresh tokens, factors).
 * The rules read staff/{uid}, so access already follows the record if an Auth step fails.
 */
import {
  can, NOT_STAFF_MANAGER, ROLE_NAMES, settingsChangeFrom, settingsChangeProblem, type StaffAction, staffActionFrom,
  staffActionProblem, type StaffRole,
} from "@sasimem/core";
import type { UserRecord } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { auth } from "../admin.js";
import type { Mailer } from "../mail/mailer.js";
import { staffInvitation } from "../mail/templates.js";
import { MAIL_SECRETS } from "../params.js";
import {
  activeStaff, consoleSettings, type StaffActor, type StaffRow, staffRows, storeSettingsChange, storeStaffAction,
} from "../store/staff.js";
import { allow, staffOf } from "./auth.js";

export interface StaffDeps {
  readonly now: () => Date;
  readonly mailer: Mailer;
  readonly consoleUrl: () => string;
}

export const LANDLORD_EMAIL =
  "That email belongs to a landlord's Sasimem account. Use a different address for staff (Settings: keep staff and landlord emails separate).";
export const EMAIL_FAILED = "Their access is saved, but the email could not be sent. Use Send again on the Staff page in a few minutes.";

/** A user's custom claims with `staffRole` set (or removed, for null), and the old `operator` claim dropped; others kept. */
export function staffClaims(existing: Record<string, unknown> | undefined, role: StaffRole | null): Record<string, unknown> {
  const { staffRole: _r, operator: _o, ...rest } = existing ?? {};
  return role === null ? rest : { ...rest, staffRole: role };
}

const isLandlord = (user: UserRecord): boolean => {
  const orgIds = user.customClaims?.["orgIds"];
  return Array.isArray(orgIds) && orgIds.length > 0;
};

async function userByEmail(email: string): Promise<UserRecord | null> {
  try {
    return await auth().getUserByEmail(email);
  } catch (e) {
    if ((e as { code?: unknown }).code === "auth/user-not-found") return null;
    throw e;
  }
}

export interface ListedStaff extends StaffRow {
  /** Has an authenticator app set up. */
  readonly codeSetUp: boolean;
  readonly lastSignInAt: string | null;
}

export function makeStaffCallables(deps: StaffDeps) {
  async function emailInvitation(actor: StaffActor, uid: string, role: StaffRole): Promise<void> {
    const user = await auth().getUser(uid);
    const email = user.email ?? "";
    try {
      const link = await auth().generatePasswordResetLink(email, { url: deps.consoleUrl() });
      await deps.mailer.send(staffInvitation({
        to: email, name: user.displayName ?? email, role: ROLE_NAMES[role], invitedBy: actor.email === "" ? "Sasimem" : actor.email, link,
      }));
    } catch (e) {
      logger.error("staff invitation email refused", { error: e instanceof Error ? e.message : String(e) });
      throw new HttpsError("aborted", EMAIL_FAILED);
    }
  }

  async function list(): Promise<ListedStaff[]> {
    const rows = await staffRows();
    const found = rows.length === 0 ? [] : (await auth().getUsers(rows.map((r) => ({ uid: r.uid })))).users;
    const users = new Map(found.map((u) => [u.uid, u]));
    return rows.map((r) => {
      const u = users.get(r.uid);
      const lastSignIn = u?.metadata.lastSignInTime;
      return {
        ...r, codeSetUp: (u?.multiFactor?.enrolledFactors.length ?? 0) > 0,
        lastSignInAt: lastSignIn === undefined || lastSignIn === null ? null : new Date(lastSignIn).toISOString(),
      };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName) || a.email.localeCompare(b.email));
  }

  /** The uid an invitation is for: the Auth user with that email, made if there is none. */
  async function inviteeUid(action: Extract<StaffAction, { kind: "invite" }>): Promise<string> {
    const existing = await userByEmail(action.email);
    if (existing !== null) {
      if ((await consoleSettings()).staffEmailSeparate && isLandlord(existing)) throw new HttpsError("failed-precondition", LANDLORD_EMAIL);
      return existing.uid;
    }
    return (await auth().createUser({ email: action.email, displayName: action.displayName, emailVerified: false })).uid;
  }

  return {
    manageStaff: onCall<unknown, Promise<{ staff?: ListedStaff[]; emailed?: boolean }>>({ maxInstances: 2, secrets: MAIL_SECRETS }, async (request) => {
      const actor = await staffOf(request);
      const action = staffActionFrom(request.data);
      if ("problem" in action) throw new HttpsError("invalid-argument", action.problem);
      if (action.kind === "list") {
        allow(can(actor.role, "staff", await consoleSettings()), NOT_STAFF_MANAGER);
        return { staff: await list() };
      }
      // Refuse what the role can never do before touching Auth (an invitation makes a user).
      if (action.kind !== "signOutEverywhere") {
        const early = staffActionProblem({ ...actor, status: "active" }, action.kind === "invite" ? action : { kind: "list" }, null, 2);
        if (early !== null) throw new HttpsError("permission-denied", early);
      }

      const targetUid = action.kind === "invite" ? await inviteeUid(action) : action.kind === "signOutEverywhere" ? actor.uid : action.uid;
      const email = action.kind === "invite" ? action.email : ((await auth().getUser(targetUid).catch(() => null))?.email ?? "");
      const done = await storeStaffAction(actor, action, targetUid, email, deps.now());
      if (done.kind === "refused") throw new HttpsError("failed-precondition", done.problem);

      const setRole = async (role: StaffRole | null) => {
        const user = await auth().getUser(targetUid);
        await auth().setCustomUserClaims(targetUid, staffClaims(user.customClaims, role));
      };
      switch (action.kind) {
        case "invite":
          await setRole(action.role);
          await emailInvitation(actor, targetUid, action.role);
          return { emailed: true };
        case "resendInvite":
          await emailInvitation(actor, targetUid, done.target?.role ?? "viewer");
          return { emailed: true };
        case "changeRole":
          await setRole(action.role);
          await auth().revokeRefreshTokens(targetUid);
          return {};
        case "reactivate":
          await setRole(done.target?.role ?? null);
          return {};
        case "suspend": case "remove":
          await setRole(null);
          await auth().revokeRefreshTokens(targetUid);
          return {};
        case "resetMfa":
          await auth().updateUser(targetUid, { multiFactor: { enrolledFactors: null } });
          await auth().revokeRefreshTokens(targetUid);
          return {};
        case "signOutEverywhere":
          await auth().revokeRefreshTokens(targetUid);
          return {};
      }
    }),

    updateSettings: onCall<unknown, Promise<{ ok: true }>>({ maxInstances: 2 }, async (request) => {
      const actor = await staffOf(request);
      const change = settingsChangeFrom(request.data);
      if ("problem" in change) throw new HttpsError("invalid-argument", change.problem);
      const problem = settingsChangeProblem(actor.role, change);
      if (problem !== null) throw new HttpsError("permission-denied", problem);
      const recipients = change.summaryRecipients;
      if (recipients !== undefined && recipients !== null) {
        const active = await activeStaff(recipients);
        if (recipients.some((uid) => !active.has(uid))) throw new HttpsError("failed-precondition", "Choose people who are active staff.");
      }
      await storeSettingsChange(actor, change, deps.now());
      return { ok: true };
    }),
  };
}
