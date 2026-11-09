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

## The operator console (S2)

The console is `apps/console`, deployed to its own Hosting site from `firebase.console.json`.
It reads only (S2): Subscribers, one subscriber's details, and Health. It works only
against a real project: the Auth emulator has no TOTP, and the rules give operators
nothing without a second factor.

Once per project, in this order:

1. **Turn on TOTP two-step codes (the owner).** Firebase console → Authentication → Settings:
   upgrade to **Identity Platform** (a small cost at this scale), then under
   **Multi-factor authentication** enable it and tick **Time-based one-time password (TOTP)**.
   Until this is done, "Set up the code" in the console says so and nothing else works.
2. **Make the Hosting site** and point the `console` target at it (dev's is in `.firebaserc`):
   ```sh
   firebase hosting:sites:create sasimem-ops-dev --project sasimem-dev
   # prod, by the owner:
   firebase hosting:sites:create sasimem-ops --project sasimem-prod
   firebase target:apply hosting console sasimem-ops --project sasimem-prod
   ```
3. **Let App Check accept the console's domain.** Rerun App Check with the site added:
   ```sh
   node ops/app-check.ts --project sasimem-dev --domain sasimem-ops-dev.web.app --domain sasimem-ops-dev.firebaseapp.com
   ```
   It reuses the same key and always keeps the project's own two domains; any other custom
   domain added earlier must be passed again, as the list is replaced.
4. **Build and deploy.** `apps/console/.env.local` holds the same values as the landlord app's
   (`apps/console/.env.example` lists them):
   ```sh
   pnpm --filter @sasimem/console build
   firebase deploy --config firebase.console.json --only hosting:console --project sasimem-dev
   ```
5. **Make yourself an operator** (step 4 of the rollout above), sign in to the console, and
   set up your code when it asks. You are then signed out: sign in again with the code.

The tick writes `system/tick` after each successful hourly run; Health shows it. The
3-hour alert still comes from the log line (`docs/runbooks/alerts.md`).
