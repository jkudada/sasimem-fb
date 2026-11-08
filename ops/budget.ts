/**
 * Print the command for the budget alert (plan §2: USD 10). A budget belongs to a billing
 * account, so this never creates one: the account's owner runs the printed command.
 *
 *   node ops/budget.ts --project sasimem-prod --i-am-the-owner --billing-account XXXXXX-XXXXXX-XXXXXX [--usd 10]
 */
import { budgetCommand } from "./src/budget.ts";
import { fail } from "./src/gcp.ts";
import { flag, projectFrom } from "./src/guard.ts";

try {
  const argv = process.argv.slice(2);
  const project = projectFrom(argv);
  const billingAccount = flag(argv, "billing-account") ?? "";
  console.log(budgetCommand({ billingAccount, project, usd: Number(flag(argv, "usd") ?? 10) }));
} catch (e) {
  fail(e);
}
