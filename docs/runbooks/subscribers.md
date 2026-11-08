# Subscribers (PLAN-SUBSCRIBERS S1)

Run from the repository root with Node 22. Each script needs `--project`; `sasimem-prod`
also needs `--i-am-the-owner`. Every write is create-only or merges claims, so each script
is safe to run twice. `--dry-run` shows what would happen and writes nothing.

## Rolling S1 out to a project, in this order

The S1 rules refuse a new tenancy for an org with no `subscriptions/{orgId}`. Backfill
first, or landlords cannot add tenancies until you do.

1. **Seed the plans** (Free, Standard, Plus; PLAN-SUBSCRIBERS §3). A plan already there
   keeps its prices.
   ```sh
   node ops/plans.ts --project sasimem-dev
   ```
2. **Backfill subscriptions** for orgs created before S1: each gets a free subscription for
   good (D6), limited to at least the tenancies it already has.
   ```sh
   node ops/backfill-subscriptions.ts --project sasimem-dev --dry-run   # look first
   node ops/backfill-subscriptions.ts --project sasimem-dev
   ```
3. **Deploy Functions and rules** (`createOrg` now starts a trial; `onTenancyWritten` is new):
   ```sh
   firebase deploy --only functions,firestore:rules --project sasimem-dev
   ```
4. **Operators** (when the console arrives in S2): turn on TOTP multi-factor first
   (Identity Platform; Authentication → Settings → Multi-factor authentication), then
   ```sh
   node ops/grant-operator.ts --project sasimem-dev --email you@example.com
   node ops/grant-operator.ts --project sasimem-dev --email them@example.com --revoke
   ```
   The claim takes effect at the user's next sign-in, and only for a session signed in
   with a second factor.

## Changing a price

Edit `plans/{id}` in the Firestore console (whole toea: K40 is `4000`). New trials lock the
new price; existing subscriptions keep theirs until renewal. `createOrg` refuses to guess
at a malformed plan document, so check the types: every number a whole number.
