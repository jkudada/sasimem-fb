# Subscribers (PLAN-SUBSCRIBERS S1-S5)

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

## Operator actions and invitations (S3)

S3 adds two callables, `operatorAction` and `invite`. They go out with a normal
Functions deploy, and `invite` sends mail, so it reads the same mail secrets as the tick:
```sh
firebase deploy --only functions,firestore:rules --project sasimem-dev
```
The rules change lets operators read `signupInvites` for the Invites page. Then rebuild and
redeploy the console (step 4 above).

- **Record a payment** on the subscriber's page when the transfer shows on the bank statement:
  the amount, the day it arrived, the bank's reference and the months it pays for (12 for
  annual, 3 for monthly billed quarterly). The same bank reference twice is one payment, so
  recording it again by mistake does nothing.
- **Every change is in the audit trail** (`operatorEvents`), with who made it and each field
  before and after. A refused change writes nothing.
- **Invite** from the Invites page with a plan, a trial length and how long the invitation
  lasts. It emails the sign-up link. "Send again" re-sends it with the same terms and a fresh
  expiry. "Revoke" deletes an unused one. A used invitation is never changed.
  `ops/invite.ts` still works: its invitations have no plan or expiry and give the standard
  60-day trial.
- **Cancel** keeps the org read-only for 90 days, and it can be reinstated until then. Purging
  comes in S6, so until then nothing is ever deleted.

## Enforcement and the landlord's Plan & billing (S4)

S4 adds the daily `subscriptionTick` (06:00 Port Moresby) and the `requestPlanChange`
callable, changes the hourly tick and `draftNow`, and opens `sasimem/billing` to signed-in
landlords. In this order:

1. **Sasimem's bank details**, which every landlord sees on their banner and Plan & billing
   page. Until they are set, both say "Ask Sasimem for the bank details". Rerun it whenever the
   details change (it replaces them):
   ```sh
   node ops/billing-details.ts --project sasimem-dev --account-name "Sasimem Ltd" --bank BSP \
     --account-number "1001 2345 678" --branch Waigani --contact-email you@example.com --dry-run
   ```
   `--contact-email` is where "Ask to change plan" goes; without it, the sending address
   (`MAIL_FROM`) gets it.
2. **Deploy** Functions, rules and the landlord app:
   ```sh
   firebase deploy --only functions,firestore:rules,hosting --project sasimem-dev
   ```
3. **The alert** for the subscription tick: rerun `node ops/alerts.ts --project sasimem-dev
   --email you@example.com`; it adds "Sasimem subscription tick failed" beside the tick's two.
4. If the console is set up, rebuild and redeploy it: its Health page now shows the
   subscription tick.

What changes for landlords:

- **Restricted** (14 days after the last day paid for, or by hand): the hourly tick drafts
  no new month for the org, and `draftNow` refuses with a plain message. A month already
  drafted is still asked for, sent, held and reminded on. The tick works this out from the
  dates every hour, so it does not wait for the daily tick.
- **Payment lifts it at once.** Record the payment in the console. The next hourly tick drafts
  the month; if its send time has passed, it is drafted held, and the landlord gets the held
  notice and can approve late.
- **The banner** on home shows in a trial's last 14 days, and while past due, restricted or
  cancelled, with the amount, the bank details and the `SUB-` reference.
- **At the limit**, "Add a tenancy" explains the limit and offers "Ask to change plan".
  The landlord's ask is emailed to Sasimem (reply goes to the landlord) and appears in the
  subscriber's audit trail as `planChangeRequested`. One ask per org per day.
- **The daily subscription tick** stores each status the dates give (audited as
  `statusChange` by `subscription-tick`) and recounts tenancies. Running it twice is harmless.

## Lifecycle emails, the digest, Metrics and Billing (S5)

S5 adds a trigger, `onSubscriptionCreated` (the welcome email), and extends the daily
`subscriptionTick` with the lifecycle emails and the operator digest. Deploy Functions, then
rebuild and redeploy the console for its Billing and Metrics pages:
```sh
firebase deploy --only functions --project sasimem-dev
```
No existing landlord is emailed by the deploy: the welcome goes only within 2 days of an
org's sign-up, and the setup nudge only within 10.

- **Landlords get** a welcome at sign-up, a nudge 3 days in if they have no tenancy, trial
  reminders 14 and 3 days before the trial ends, and one email each when they go past due and
  when they are restricted for non-payment. Each is in the org's email log in the console.
- **You get** a digest each morning at 06:00 Port Moresby, only when there is something to
  say: new sign-ups, trials ending within 7 days, past due, restricted, held runs and failed
  emails. It goes to the `--contact-email` from `ops/billing-details.ts`, else to `MAIL_FROM`.
- **Billing** in the console: renewals due within 30 days, who is overdue, payments this
  month, and a CSV of payments for the months you choose, to tick off against the bank
  statement. **Metrics**: subscribers by plan and status, annual recurring revenue (active
  and past-due subscriptions at their locked price), trial conversion, cancellations and
  invoices sent by month.
