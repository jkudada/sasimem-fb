/**
 * Set Sasimem's own bank details and contact address (PLAN-SUBSCRIBERS S4) in
 * sasimem/billing. Every landlord sees them on their subscription banner and the Plan &
 * billing page; "Ask to change plan" emails the contact address (the sending address if none).
 * Replaces what is there, so run it again whenever the bank details change.
 *
 *   node ops/billing-details.ts --project sasimem-dev --account-name "Sasimem Ltd" --bank BSP \
 *     --account-number "1001 2345 678" [--branch Waigani] [--contact-email help@sasimem.example] [--dry-run]
 */
import { fail } from "./src/gcp.ts";
import { commit } from "./src/firestore.ts";
import { flag, has, projectFrom } from "./src/guard.ts";
import { billingDetailsWrite } from "./src/subscribers.ts";

async function main() {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const write = billingDetailsWrite(project, {
    accountName: flag(argv, "account-name"), bankName: flag(argv, "bank"), accountNumber: flag(argv, "account-number"),
    branch: flag(argv, "branch"), contactEmail: flag(argv, "contact-email"),
  });
  const shown = Object.entries(write.update.fields).map(([k, v]) => `  ${k}: ${"stringValue" in v ? v.stringValue : "(none)"}`).join("\n");
  console.log(`${has(argv, "dry-run") ? "Would set" : "Setting"} sasimem/billing in ${project}:\n${shown}`);
  if (!has(argv, "dry-run")) await commit(project, [write]);
}

main().catch(fail);
