/**
 * Sasimem's staff and what each may do in the console (docs/PLAN-ADMIN-DASHBOARD.md §4,
 * §5, §9, phase A1), as pure functions. The console uses them to choose what to show,
 * the callables (manageStaff, updateSettings, operatorAction, invite) to refuse, and
 * firestore.rules mirrors them; tests on each side hold the three together.
 */

export type StaffRole = "owner" | "manager" | "supervisor" | "support" | "viewer";
export const STAFF_ROLES: readonly StaffRole[] = ["owner", "manager", "supervisor", "support", "viewer"];
export const ROLE_NAMES: Readonly<Record<StaffRole, string>> = {
  owner: "Owner", manager: "Manager", supervisor: "Supervisor", support: "Support", viewer: "Viewer",
};
export const isStaffRole = (v: unknown): v is StaffRole => STAFF_ROLES.includes(v as StaffRole);

/** A staff member's standing. Removed staff keep their document, for the audit trail. */
export type StaffStatus = "active" | "suspended" | "removed";

export interface StaffMember {
  readonly uid: string;
  readonly role: StaffRole;
  readonly status: StaffStatus;
}

// ---------------------------------------------------------------- settings (§5)

export interface ConsoleSettings {
  /** S1: Managers see customers' names. Owner only. */
  readonly managersSeeNames: boolean;
  /** S2: the system-wide rent volume is shown. Owner or Manager. */
  readonly showRentVolume: boolean;
  /** S3: "view as" a customer is available at all. Owner only. */
  readonly viewAsEnabled: boolean;
  /** S4: who gets the monthly summary; null means every active Manager. Owner only. */
  readonly summaryRecipients: readonly string[] | null;
  /** S5: a staff invitation is refused for an email that belongs to a landlord, and the reverse. Owner or Manager. */
  readonly staffEmailSeparate: boolean;
}
export type SettingKey = keyof ConsoleSettings;

export const DEFAULT_SETTINGS: ConsoleSettings = {
  managersSeeNames: false, showRentVolume: true, viewAsEnabled: false, summaryRecipients: null, staffEmailSeparate: true,
};
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as readonly SettingKey[];

/** Who may change each setting. */
export const SETTING_EDITORS: Readonly<Record<SettingKey, readonly StaffRole[]>> = {
  managersSeeNames: ["owner"],
  showRentVolume: ["owner", "manager"],
  viewAsEnabled: ["owner"],
  summaryRecipients: ["owner"],
  staffEmailSeparate: ["owner", "manager"],
};

export const MAX_SUMMARY_RECIPIENTS = 50;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const isUid = (v: unknown): v is string => typeof v === "string" && UID.test(v);

/** The stored settings document, or the defaults for anything missing or malformed. */
export function settingsFrom(data: unknown): ConsoleSettings {
  const o = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const flag = (k: Exclude<SettingKey, "summaryRecipients">): boolean => (typeof o[k] === "boolean" ? o[k] : DEFAULT_SETTINGS[k]);
  const r = o["summaryRecipients"];
  return {
    managersSeeNames: flag("managersSeeNames"),
    showRentVolume: flag("showRentVolume"),
    viewAsEnabled: flag("viewAsEnabled"),
    summaryRecipients: Array.isArray(r) && r.every(isUid) ? r : null,
    staffEmailSeparate: flag("staffEmailSeparate"),
  };
}

export type SettingsChange = Partial<{ -readonly [K in SettingKey]: ConsoleSettings[K] }>;

/** Read a change to the settings from untrusted data: only known keys, each of the right type. */
export function settingsChangeFrom(data: unknown): SettingsChange | { readonly problem: string } {
  const unreadable = { problem: "That change could not be read. Reload the page and try again." };
  if (typeof data !== "object" || data === null || Array.isArray(data)) return unreadable;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return { problem: "Nothing to change." };
  const change: SettingsChange = {};
  for (const [k, v] of entries) {
    if (!SETTING_KEYS.includes(k as SettingKey)) return unreadable;
    if (k === "summaryRecipients") {
      if (v === null) change.summaryRecipients = null;
      else if (Array.isArray(v) && v.every(isUid)) {
        if (v.length > MAX_SUMMARY_RECIPIENTS) return { problem: `The summary goes to at most ${MAX_SUMMARY_RECIPIENTS} people.` };
        change.summaryRecipients = [...new Set(v)];
      } else return unreadable;
    } else {
      if (typeof v !== "boolean") return unreadable;
      change[k as Exclude<SettingKey, "summaryRecipients">] = v;
    }
  }
  return change;
}

/** Why this role may not make this change, or null if it may. */
export function settingsChangeProblem(role: StaffRole, change: SettingsChange): string | null {
  for (const k of Object.keys(change) as SettingKey[]) {
    if (!SETTING_EDITORS[k].includes(role)) {
      const who = SETTING_EDITORS[k].map((r) => ROLE_NAMES[r]).join(" or ");
      return `Only ${who === "Owner" ? "an Owner" : `an ${who}`} can change that setting.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- permissions (§4)

export type Capability =
  /** The aggregate pages: Health now; Overview, Growth, Usage and Email delivery from A3. */
  | "stats"
  /** Customers' names beside their numbers. */
  | "names"
  /** The system-wide rent volume (A3). */
  | "rentVolume"
  /** Read subscriptions: plan, status, limits. */
  | "subscriptions"
  /** The Billing page, payments, and every subscription action but notes. */
  | "billing"
  /** Read and add notes on a subscriber. */
  | "notes"
  /** Invitations to sign up. */
  | "invites"
  /**
   * A customer's own records: properties, tenants, runs, invoices, emails. Until A2 only
   * the Owner, as the operator was; A2 replaces this with audited "view as" grants.
   */
  | "orgRecords"
  /** "View as" a customer (A2): the Owner and Support, while the Owner allows it (S3). */
  | "viewAs"
  /** The Staff page and its actions. */
  | "staff";

export function can(role: StaffRole, capability: Capability, settings: ConsoleSettings): boolean {
  switch (capability) {
    case "stats": return true;
    case "names": return role === "owner" || role === "supervisor" || role === "support" || (role === "manager" && settings.managersSeeNames);
    case "rentVolume": return settings.showRentVolume && role !== "support";
    case "subscriptions": case "notes": case "invites": return role !== "viewer";
    case "billing": return role === "owner" || role === "manager" || role === "supervisor";
    case "orgRecords": return role === "owner";
    case "viewAs": return settings.viewAsEnabled && (role === "owner" || role === "support");
    case "staff": return role === "owner" || role === "manager";
  }
}

/** Whose audit entries a role reads: all, its team's (Supervisors and Support), its own, or none. */
export type AuditScope = "all" | "team" | "own" | "none";
export const TEAM_ROLES: readonly StaffRole[] = ["supervisor", "support"];
export function auditScope(role: StaffRole): AuditScope {
  switch (role) {
    case "owner": case "manager": return "all";
    case "supervisor": return "team";
    case "support": return "own";
    case "viewer": return "none";
  }
}

/** Which subscription actions (core's OperatorActionKind) a role may take. */
export function canTakeAction(role: StaffRole, kind: string, settings: ConsoleSettings): boolean {
  return kind === "addNote" ? can(role, "notes", settings) : can(role, "billing", settings);
}

// ---------------------------------------------------------------- staff actions (§9)

export const MAX_DISPLAY_NAME = 80;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StaffAction =
  | { readonly kind: "list" }
  | { readonly kind: "invite"; readonly email: string; readonly role: StaffRole; readonly displayName: string }
  | { readonly kind: "changeRole"; readonly uid: string; readonly role: StaffRole }
  | { readonly kind: "suspend"; readonly uid: string }
  | { readonly kind: "reactivate"; readonly uid: string }
  | { readonly kind: "remove"; readonly uid: string }
  | { readonly kind: "resetMfa"; readonly uid: string }
  /** Email the set-password link again, to someone invited who is still active. */
  | { readonly kind: "resendInvite"; readonly uid: string }
  /** Anyone, on themselves: every other session ends. */
  | { readonly kind: "signOutEverywhere" };
export type StaffActionKind = StaffAction["kind"];

const ON_SOMEONE = ["changeRole", "suspend", "reactivate", "remove", "resetMfa", "resendInvite"] as const;
type OnSomeone = Extract<StaffAction, { uid: string }>;

/** Read a staff action from untrusted data; a plain-English problem if it is not one. */
export function staffActionFrom(data: unknown): StaffAction | { readonly problem: string } {
  const unreadable = { problem: "That could not be read. Reload the page and try again." };
  if (typeof data !== "object" || data === null) return unreadable;
  const o = data as Record<string, unknown>;
  const kind = o["kind"];
  if (kind === "list" || kind === "signOutEverywhere") return { kind };
  if (kind === "invite") {
    const email = typeof o["email"] === "string" ? o["email"].trim().toLowerCase() : "";
    if (!EMAIL.test(email)) return { problem: "Enter their email address, like name@example.com." };
    if (!isStaffRole(o["role"])) return { problem: "Choose a role." };
    const displayName = typeof o["displayName"] === "string" ? o["displayName"].trim() : "";
    if (displayName === "") return { problem: "Enter their name." };
    if (displayName.length > MAX_DISPLAY_NAME) return { problem: `A name is at most ${MAX_DISPLAY_NAME} characters.` };
    return { kind, email, role: o["role"], displayName };
  }
  if (!ON_SOMEONE.includes(kind as OnSomeone["kind"])) return unreadable;
  if (!isUid(o["uid"])) return unreadable;
  if (kind === "changeRole") {
    if (!isStaffRole(o["role"])) return { problem: "Choose a role." };
    return { kind, uid: o["uid"], role: o["role"] };
  }
  return { kind: kind as Exclude<OnSomeone["kind"], "changeRole">, uid: o["uid"] };
}

/** Owners and Managers are made, changed and removed only by an Owner. */
const SENIOR: readonly StaffRole[] = ["owner", "manager"];
export const rolesAssignableBy = (role: StaffRole): readonly StaffRole[] =>
  role === "owner" ? STAFF_ROLES : role === "manager" ? STAFF_ROLES.filter((r) => !SENIOR.includes(r)) : [];

export const NOT_STAFF_MANAGER = "Only an Owner or a Manager can manage staff.";
export const ONLY_OWNER_FOR_SENIOR = "Only an Owner can add, change or remove an Owner or a Manager.";
export const NOT_YOURSELF = "You cannot change your own access. Ask another Owner.";
export const LAST_OWNER = "There must always be an active Owner. Make someone else an Owner first.";

/**
 * Why `actor` may not take `action`, or null if they may. `target` is the staff member the
 * action names (null if there is none, or for an invitation, the existing record for that
 * email if any); `activeOwners` counts active Owners now.
 */
export function staffActionProblem(
  actor: StaffMember, action: StaffAction, target: StaffMember | null, activeOwners: number,
): string | null {
  if (action.kind === "signOutEverywhere") return null;
  const assignable = rolesAssignableBy(actor.role);
  if (assignable.length === 0) return NOT_STAFF_MANAGER;
  if (action.kind === "list") return null;

  if (action.kind === "invite") {
    if (!assignable.includes(action.role)) return ONLY_OWNER_FOR_SENIOR;
    if (target !== null && target.status !== "removed") return "That person is already staff. Change their role instead.";
    return null;
  }

  if (target === null || target.status === "removed") return "That person is not staff.";
  if (target.uid === actor.uid) return NOT_YOURSELF;
  if (!assignable.includes(target.role)) return ONLY_OWNER_FOR_SENIOR;
  const losesOwner = target.role === "owner" && target.status === "active" && activeOwners <= 1;
  switch (action.kind) {
    case "changeRole":
      if (!assignable.includes(action.role)) return ONLY_OWNER_FOR_SENIOR;
      if (action.role === target.role) return `They are already ${ROLE_NAMES[target.role]}.`;
      return losesOwner ? LAST_OWNER : null;
    case "suspend":
      if (target.status !== "active") return "They are already suspended.";
      return losesOwner ? LAST_OWNER : null;
    case "reactivate":
      return target.status === "suspended" ? null : "They are not suspended.";
    case "remove":
      return losesOwner ? LAST_OWNER : null;
    case "resetMfa":
      return null;
    case "resendInvite":
      return target.status === "active" ? null : "Reactivate them first.";
  }
}

/** The staff document after an allowed action; null for actions that do not change it. */
export function staffAfter(action: StaffAction, target: StaffMember | null): Pick<StaffMember, "role" | "status"> | null {
  switch (action.kind) {
    case "invite": return { role: action.role, status: "active" };
    case "changeRole": return target === null ? null : { role: action.role, status: target.status };
    case "suspend": return target === null ? null : { role: target.role, status: "suspended" };
    case "reactivate": return target === null ? null : { role: target.role, status: "active" };
    case "remove": return target === null ? null : { role: target.role, status: "removed" };
    default: return null;
  }
}
