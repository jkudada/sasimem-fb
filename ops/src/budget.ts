/**
 * The budget alert (plan §2: USD 10). A budget belongs to a billing account, not a
 * project, so these scripts never create one: they print the command for the owner.
 */
const BILLING_ACCOUNT = /^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/;

export function budgetCommand(o: { billingAccount: string; project: string; usd: number }): string {
  if (!BILLING_ACCOUNT.test(o.billingAccount)) throw new Error(`"${o.billingAccount}" is not a billing account ID (XXXXXX-XXXXXX-XXXXXX).`);
  if (!Number.isInteger(o.usd) || o.usd < 1) throw new Error("The amount must be a whole number of dollars, at least 1.");
  return [
    `gcloud billing budgets create --billing-account=${o.billingAccount} --display-name="Sasimem ${o.project} USD ${o.usd}"`,
    `--budget-amount=${o.usd}USD --filter-projects=projects/${o.project}`,
    "--threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0",
  ].join(" ");
}
