/**
 * Make someone console staff in a role, or --revoke it (docs/PLAN-ADMIN-DASHBOARD.md A1).
 * For bootstrap (the first Owner) and break-glass: otherwise an Owner or a Manager uses
 * the console's Staff page. Writes the staff/{uid} record the rules read, an audit entry,
 * and the `staffRole` claim the console reads to choose its pages (dropping the old
 * `operator` claim; other claims are kept). Staff also need a second factor (TOTP).
 *
 *   node ops/grant-staff.ts --project sasimem-dev --email you@example.com [--role owner] [--revoke]
 */
import { call, fail } from "./src/gcp.ts";
import { commit } from "./src/firestore.ts";
import { flag, has, projectFrom } from "./src/guard.ts";
import { OPS_STAFF_ROLES, type OpsStaffRole, staffClaims, staffWrites } from "./src/subscribers.ts";

const API = "https://identitytoolkit.googleapis.com/v1";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const email = flag(argv, "email");
  if (email === undefined || !email.includes("@")) throw new Error("Name the user: --email <address>.");
  const role = (flag(argv, "role") ?? "owner") as OpsStaffRole;
  if (!OPS_STAFF_ROLES.includes(role)) throw new Error(`--role is one of ${OPS_STAFF_ROLES.join(", ")}.`);
  const found = await call<{ users?: { localId: string; email?: string; customAttributes?: string }[] }>({
    method: "POST", url: `${API}/projects/${project}/accounts:lookup`, body: { email: [email] },
  });
  const user = found.users?.[0];
  if (user === undefined) throw new Error(`No user ${email} in ${project}. Add them in the Auth console first (or invite them from the console's Staff page).`);
  const revoke = has(argv, "revoke");
  await commit(project, staffWrites(project, { uid: user.localId, email: user.email ?? email }, role, revoke, new Date(), crypto.randomUUID()));
  const customAttributes = staffClaims(user.customAttributes, revoke ? null : role);
  await call({ method: "POST", url: `${API}/projects/${project}/accounts:update`, body: { localId: user.localId, customAttributes, ...(revoke ? { validSince: String(Math.floor(Date.now() / 1000)) } : {}) } });
  console.log(`${revoke ? "Removed" : `Made ${role}`}: ${email} in ${project}. Claims now: ${customAttributes}`);
  console.log(revoke ? "Their sessions are ended." : "They sign out and in again, with their authenticator code, for it to take effect.");
}

main().catch(fail);
