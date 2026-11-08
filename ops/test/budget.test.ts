import { describe, expect, test } from "vitest";
import { budgetCommand } from "../src/budget.ts";

describe("the budget alert (plan §2: $10)", () => {
  test("a gcloud command for the owner to run, warning at 50%, 90% and 100%", () => {
    expect(budgetCommand({ billingAccount: "012345-6789AB-CDEF01", project: "sasimem-prod", usd: 10 })).toBe(
      "gcloud billing budgets create --billing-account=012345-6789AB-CDEF01 --display-name=\"Sasimem sasimem-prod USD 10\" " +
        "--budget-amount=10USD --filter-projects=projects/sasimem-prod " +
        "--threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0",
    );
  });

  test("a malformed billing account or amount is refused", () => {
    expect(() => budgetCommand({ billingAccount: "billing; rm -rf /", project: "sasimem-prod", usd: 10 })).toThrow("billing account");
    expect(() => budgetCommand({ billingAccount: "012345-6789AB-CDEF01", project: "sasimem-prod", usd: 0 })).toThrow("amount");
  });
});
