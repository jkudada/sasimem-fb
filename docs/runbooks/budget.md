# Budget alert

Plan §2 expects about USD 0-3 a month plus email, and asks for an alert at USD 10. A budget
belongs to a billing account, not a project, so no script creates one. This one prints the
command for the billing account's owner to run:

```sh
node ops/budget.ts --project sasimem-prod --i-am-the-owner --billing-account XXXXXX-XXXXXX-XXXXXX [--usd 10]
```

It prints, for example:

```sh
gcloud billing budgets create --billing-account=XXXXXX-XXXXXX-XXXXXX --display-name="Sasimem sasimem-prod USD 10" \
  --budget-amount=10USD --filter-projects=projects/sasimem-prod \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

Billing admins on the account receive emails at 50%, 90% and 100% of the month's amount. A
budget only warns; it never stops spending. Find the billing account ID with
`gcloud billing projects describe sasimem-prod`. A separate budget for `sasimem-dev` is optional
(pass `--project sasimem-dev`).
