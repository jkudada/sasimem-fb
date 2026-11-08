/**
 * Grant (or --revoke) the operator claim (PLAN-SUBSCRIBERS D10). The claim alone is not
 * enough: the rules also need the session signed in with a second factor. Other claims
 * (orgIds) are kept. The user must sign out and in again for it to take effect.
 *
 *   node ops/grant-operator.ts --project sasimem-dev --email you@example.com [--revoke]
 */
import { call, fail } from "./src/gcp.ts";
import { flag, has, projectFrom } from "./src/guard.ts";
import { operatorClaims } from "./src/subscribers.ts";

const API = "https://identitytoolkit.googleapis.com/v1";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const email = flag(argv, "email");
  if (email === undefined || !email.includes("@")) throw new Error("Name the user: --email <address>.");
  const found = await call<{ users?: { localId: string; customAttributes?: string }[] }>({
    method: "POST", url: `${API}/projects/${project}/accounts:lookup`, body: { email: [email] },
  });
  const user = found.users?.[0];
  if (user === undefined) throw new Error(`No user ${email} in ${project}. They sign up (or are added in the Auth console) first.`);
  const grant = !has(argv, "revoke");
  const customAttributes = operatorClaims(user.customAttributes, grant);
  await call({ method: "POST", url: `${API}/projects/${project}/accounts:update`, body: { localId: user.localId, customAttributes } });
  console.log(`${grant ? "Granted" : "Revoked"} operator for ${email} in ${project}. Claims now: ${customAttributes}`);
  console.log("It takes effect at their next sign-in; operator reads also need a second factor (TOTP).");
}

main().catch(fail);
