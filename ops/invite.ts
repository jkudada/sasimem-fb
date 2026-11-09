/**
 * Invite an email to sign up (docs/PLAN-TEMPLATES.md §7). One invitation makes one
 * organisation; createOrg uses it up.
 *
 *   node ops/invite.ts --project sasimem-dev name@example.com
 *   node ops/invite.ts --project sasimem-prod --i-am-the-owner name@example.com
 */
import { ApiError, call, fail } from "./src/gcp.ts";
import { projectFrom } from "./src/guard.ts";
import { inviteEmail, inviteRequest } from "./src/invite.ts";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const email = inviteEmail(argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--project"));
  try {
    await call(inviteRequest(project, email, new Date()));
    console.log(`Invited ${email} to sign up on ${project}. They sign up with this address, confirm it, and create their organisation.`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      console.log(`${email} is already invited on ${project} (an invitation is never reset).`);
      return;
    }
    throw e;
  }
}

main().catch(fail);
