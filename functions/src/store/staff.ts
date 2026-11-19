/**
 * Staff records and the console's settings (docs/PLAN-ADMIN-DASHBOARD.md §5, §9): the
 * only code that writes `staff/*` and `console/settings`. Every change is written with
 * its operatorEvents entry in one transaction; core's staff.ts decides what is allowed.
 */
import {
  type ConsoleSettings, isStaffRole, type SettingsChange, settingsFrom, type StaffAction, staffActionProblem, staffAfter,
  type StaffMember, type StaffRole, type StaffStatus,
} from "@sasimem/core";
import type { Transaction } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { type Actor, actorFields } from "./subscriptions.js";

export interface StaffActor extends Actor {
  readonly role: StaffRole;
}

const STATUSES: readonly StaffStatus[] = ["active", "suspended", "removed"];
const staffRef = (uid: string) => db().doc(`staff/${uid}`);
export const settingsRef = () => db().doc("console/settings");

function memberFrom(uid: string, data: FirebaseFirestore.DocumentData | undefined): StaffMember | null {
  if (data === undefined || !isStaffRole(data["role"]) || !STATUSES.includes(data["status"] as StaffStatus)) return null;
  return { uid, role: data["role"], status: data["status"] as StaffStatus };
}

/** The staff record for this uid, or null if there is none (or it is malformed). */
export async function staffMember(uid: string): Promise<StaffMember | null> {
  return memberFrom(uid, (await staffRef(uid).get()).data());
}

export async function consoleSettings(): Promise<ConsoleSettings> {
  return settingsFrom((await settingsRef().get()).data());
}

const activeOwners = async (tx: Transaction): Promise<number> =>
  (await tx.get(db().collection("staff").where("role", "==", "owner").where("status", "==", "active"))).size;

export type StaffChange =
  | { readonly kind: "refused"; readonly problem: string }
  | { readonly kind: "done"; readonly target: StaffMember | null };

/** Audit kinds, by action. */
const EVENT: Record<Exclude<StaffAction["kind"], "list">, string> = {
  invite: "staffInvited", resendInvite: "staffInviteResent", changeRole: "staffRoleChanged", suspend: "staffSuspended",
  reactivate: "staffReactivated", remove: "staffRemoved", resetMfa: "staffMfaReset", signOutEverywhere: "staffSignedOutEverywhere",
};

/**
 * Check and record one staff action. For an invitation, `targetUid` is the Auth user
 * found or made for the email; for signing out everywhere, the actor themselves. The
 * actor's own record is re-read inside the transaction, so a suspension made a moment
 * ago is honoured. Auth (claims, tokens, factors) is the caller's to change afterwards.
 */
export async function storeStaffAction(
  actor: StaffActor, action: Exclude<StaffAction, { kind: "list" }>, targetUid: string, email: string, now: Date,
): Promise<StaffChange> {
  return db().runTransaction(async (tx): Promise<StaffChange> => {
    const [me, targetSnap, owners] = await Promise.all([tx.get(staffRef(actor.uid)), tx.get(staffRef(targetUid)), activeOwners(tx)]);
    const self = memberFrom(actor.uid, me.data());
    if (self === null || self.status !== "active") return { kind: "refused", problem: "Your own access has changed. Sign in again." };
    const target = memberFrom(targetUid, targetSnap.data());
    const problem = staffActionProblem(self, action, target, owners);
    if (problem !== null) return { kind: "refused", problem };

    const after = staffAfter(action, target);
    const before = target === null ? {} : { role: target.role, status: target.status };
    if (action.kind === "invite") {
      tx.set(staffRef(targetUid), {
        role: action.role, status: "active", email, displayName: action.displayName,
        invitedBy: actor.uid, invitedByEmail: actor.email, createdAt: now, updatedAt: now, lastSeenAt: null,
      });
    } else if (after !== null) {
      tx.update(staffRef(targetUid), { ...after, updatedAt: now });
    }
    tx.create(db().collection("operatorEvents").doc(), {
      kind: EVENT[action.kind], ...actorFields(actor), at: now, staffUid: targetUid, staffEmail: email,
      before: after === null ? {} : before, after: after ?? {},
    });
    return { kind: "done", target: after === null ? target : { uid: targetUid, ...after } };
  });
}

export interface StaffRow {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: StaffRole;
  readonly status: StaffStatus;
  readonly lastSeenAt: string | null;
}

/** Every staff record, removed ones too (the Staff page hides them unless asked). */
export async function staffRows(): Promise<StaffRow[]> {
  const snap = await db().collection("staff").get();
  return snap.docs.flatMap((d) => {
    const m = memberFrom(d.id, d.data());
    if (m === null) return [];
    const seen = d.get("lastSeenAt") as FirebaseFirestore.Timestamp | null | undefined;
    return [{
      ...m, email: String(d.get("email") ?? ""), displayName: String(d.get("displayName") ?? ""),
      lastSeenAt: seen == null ? null : seen.toDate().toISOString(),
    }];
  });
}

/** Active staff among these uids: the summary goes only to people who still work here. */
export async function activeStaff(uids: readonly string[]): Promise<Set<string>> {
  if (uids.length === 0) return new Set();
  const snaps = await db().getAll(...uids.map(staffRef));
  return new Set(snaps.filter((s) => memberFrom(s.id, s.data())?.status === "active").map((s) => s.id));
}

/** Apply a settings change and audit it with the values before and after. */
export async function storeSettingsChange(actor: StaffActor, change: SettingsChange, now: Date): Promise<ConsoleSettings> {
  return db().runTransaction(async (tx) => {
    const current = settingsFrom((await tx.get(settingsRef())).data());
    const keys = Object.keys(change) as (keyof ConsoleSettings)[];
    const before = Object.fromEntries(keys.map((k) => [k, current[k]]));
    const next = { ...current, ...change };
    tx.set(settingsRef(), { ...next, updatedAt: now, updatedBy: actor.uid });
    tx.create(db().collection("operatorEvents").doc(), { kind: "settingChanged", ...actorFields(actor), at: now, before, after: change });
    return next;
  });
}
