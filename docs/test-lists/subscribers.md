# Subscribers test list (docs/PLAN-SUBSCRIBERS.md)

S1 done (2026-11-08), S2 done (2026-11-09), S3 done (2026-11-11); S4-S6 to come.

Written before the code (plan §9.1 of PLAN-SASIMEM-FB). Ticked as each goes red → green.
Phases S1-S6 match PLAN-SUBSCRIBERS §12; each phase's items land in its PR.

## S1 - core (T1)
- [x] the three seeded plans have the §3 limits and prices, in integer toea; annual = 10 × monthly
- [x] a subscription's limit is its `limitOverride` when set, else its plan's
- [x] `canAddTenancy`: true below the limit, false at it and above it
- [x] a tenancy counts toward the limit until its end date has passed
- [x] `subscriptionStatus`: a trial stays a trial through `trialEndsOn`
- [x] … the day after, active if `paidThrough` has not passed, else past_due
- [x] … paying during a trial does not end it early
- [x] … active through `paidThrough`, past_due the day after
- [x] … past_due for `graceDays`, then restricted (grace 0: restricted at once)
- [x] … past_due or restricted with `paidThrough` not passed becomes active
- [x] … free never changes on its own; cancelled becomes purged only at `purgeAfter`; purged stays
- [x] … is idempotent: applying it to its own answer gives the same answer
- [x] dates are Port Moresby calendar dates, each the last day covered (changed from instants: the plan's "00:00 PNG time" falls out of it)
- [x] `extendPaidThrough`: twelve months after the last day covered
- [x] … paid during a trial, the year starts when the trial ends
- [x] … paid while past due, it counts from the old `paidThrough` (no free days)
- [x] … paid while restricted, it counts from today (the landlord was not being served)
- [x] … a month-end `paidThrough` stays at month end; a missing day (30 Feb) clamps
- [x] payment references are `SUB-` + 4 digits (more when needed), from a counter, never reused
- [x] `canDraft(status)`: trial, free, active, past_due → yes; restricted, cancelled, purged → no
- [x] a sign-up's subscription: Standard trial, 60 days, annual price locked; a pre-billing org's: free, limit ≥ its tenancies
- [x] a plan document from Firestore is used as it is; missing → the default; malformed → refused
- moved to S4: the banner text (it needs Sasimem's bank details, which arrive with the Plan & billing page)

## S1 - rules (T2)
- [x] an owner reads their own `subscriptions/{orgId}` and its payments; a stranger reads neither
- [x] an owner cannot write `subscriptions`, `payments`, `plans`, `operatorEvents` or `signupInvites` (I9 list)
- [x] an owner cannot read `subscriptions/{orgId}/notes` or `operatorEvents`
- [x] creating a tenancy at the limit is refused; below it, allowed
- [x] creating a tenancy with no subscription document is refused
- [x] updating, ending or deleting a tenancy at or over the limit is still allowed
- [x] an operator with a second factor reads any org, its setup, runs, invoices, emails, subscription, notes, payments, and `operatorEvents`; not `private/*`
- [x] an `operator` claim without a second factor reads nothing beyond their own orgs
- [x] an operator writes nothing directly
- [x] any signed-in user reads `plans`; nobody signed out

## S1 - functions (T3)
- [x] `createOrg` makes a trial subscription: Standard, 60 days, the next `SUB-` reference, `activeTenancyCount` 0, in the same transaction
- [x] references are consecutive across sign-ups; a retried `createOrg` uses no second reference
- [x] `createOrg` takes price and limit from `plans/standard` when it exists
- [x] in invite mode (Templates P5), an invited sign-up gets its trial; a refused one starts no trial and uses no reference (every read before any write)
- [x] the count trigger **recounts** on every tenancy write (not +1/−1): ended tenancies drop out, drift is corrected both ways, other orgs untouched, no subscription → no write, unchanged → no write
- moved to S3: `createOrg` with an invite's plan `free` (invites arrive with P5)

## S1 - ops (T1, plus a dry run on sasimem-dev)
- [x] the ops copies of the plans and of the free subscription equal core's (the scripts cannot import core)
- [x] Firestore REST values: strings, whole numbers, booleans, null, instants; a fraction is refused (I7)
- [x] `ops/plans.ts` creates only the missing plans, create-only
- [x] `ops/backfill-subscriptions.ts` gives each org without one a free subscription counting its tenancies that have not ended, create-only (safe twice)
- [x] `ops/grant-operator.ts` adds `operator: true` keeping `orgIds`; `--revoke` removes only it
- [x] dry runs against sasimem-dev: 3 plans to create; 1 org to backfill (1 tenancy, limit 2)

## S2 - operator console (T1, T2, T3)
The Auth emulator has no TOTP (it supports SMS second factors only), so there is no T4
journey for the console: who gets in is a pure function (T1), what they can read is the
rules (T2), and a real sign-in is tried on sasimem-dev once TOTP is on there.
- [x] who gets in: signed out → sign-in; operator with code → in; no code set up → set one up; code set up but not used this session → sign in again; no operator claim → told so (T1, session.ts)
- [x] sign-in asks for the authenticator code when Firebase requires it; a wrong code and a wrong password each say so in plain words (T1)
- [x] setting up a code shows the key and an otpauth link, takes the code, reads no data; a project without TOTP says so (T1)
- [x] Subscribers lists every org with plan, status as of today (from core, not the stored field), used / limit, the date that matters, reference, last approval, problems (T1)
- [x] each filter narrows correctly: all, past due, restricted, trial ending in 14 days, needs a look (T1)
- [x] needs a look: a held run, failed emails in 30 days, no approval in 2 months (orgs older than that), over the limit, no subscription (T1)
- [x] Subscriber shows org, subscription, payments, notes, audit trail, runs, the latest run's invoices and 30 days of email, with no button that writes; an unknown ID says so (T1)
- [x] Health shows the last successful tick (overdue after 3 hours), held runs, failed emails and quiet orgs, each linking to the org (T1)
- [x] the tick records `system/tick` after a successful full run; a scoped (test) tick does not (T3)
- [x] operators read `system/tick` and list `orgs`, `subscriptions` and an org's runs; owners cannot read `system/tick` or list `orgs` (T2; `system/tick` added to I9)
- [x] the console is its own package and Hosting site (`firebase.console.json`); the landlord app's sources and budgets are untouched

## S3 - operator actions (T1 core, T2 rules, T3 callables, T1 console)
Each action is a pure function in core (subscription-actions.ts); one callable,
`operatorAction`, guards, loads, applies and stores them, so no action can skip the check.

### core (T1)
- [x] an action reads only what it is sent: an unknown kind or a malformed field is refused in plain words (the console and the server agree)
- [x] every action that changes the subscription re-evaluates its status as of today
- [x] a purged subscription takes no action; a cancelled one takes only `reinstate` and `addNote`
- [x] an action that would change nothing is refused ("nothing to change"), so the audit trail holds only changes
- [x] `recordPayment`: whole toea above zero, a real date not after today, a bank reference, 1-36 months; free is refused
- [x] … moves `paidThrough` by the months paid, as `extendPaidThrough` on the day the money arrived (late recording costs the landlord nothing)
- [x] … says which days it covers (`coversFrom`, `coversTo`)
- [x] … lifts past_due and restricted to active
- [x] `changePlan`: locks the new plan's price for the interval; the limit follows the plan unless overridden
- [x] … to free: status free, price 0; from free to a paid plan: given a `SUB-` reference if it has none, and past due until paid or given a trial
- [x] … a downgrade below current use changes no count: over the limit means no new tenancies, nothing ended
- [x] `extendTrial`: 1-365 days after the later of the trial's end and yesterday; past due becomes trial again; free is refused
- [x] `setLimitOverride`: a whole number 1-1000 sets the limit; clearing it returns the plan's limit
- [x] `restrict` (by hand) holds the status at restricted whatever the dates, free included; the daily recompute keeps it; `unrestrict` clears only that, and says so when the restriction is for non-payment
- [x] … a payment while restricted by hand still counts from the covered day, not today
- [x] `cancelSubscription`: cancelled today, purge 90 days on; `reinstate` before then gives back the status the dates say (free stays free), after it is refused
- [x] `addNote`: 1-2000 characters, the subscription untouched
- [x] the audit diff lists only the fields that changed, before and after

### rules (T2)
- [x] operators read `signupInvites`; owners and strangers still cannot

### callables (T3)
- [x] every action refuses a caller without `operator`, and one with it but no second factor; it writes nothing
- [x] an unknown org, or an org with no subscription, is refused plainly
- [x] `recordPayment` writes the payment, moves `paidThrough`, re-evaluates status, and writes one `operatorEvents` entry with before and after - in one transaction
- [x] `recordPayment` twice with the same bank reference records it once (the second says it was already recorded)
- [x] `changePlan` downgrade below current use keeps every tenancy and blocks new ones
- [x] `changePlan` from free uses the next `SUB-` reference from the shared counter
- [x] `extendTrial`, `setLimitOverride`, `restrict`, `unrestrict`, `cancelSubscription`, `reinstate`, `addNote` each change only what they name and are audited (actor, email, kind, org, before, after)
- [x] a refused action writes nothing, not even an audit entry
- [x] invites carry a plan, a trial length and an expiry; `createOrg` uses them; a used or expired invite is refused
- [x] `createOrg` with an invite's plan `free` makes a free subscription with no trial and no reference (moved from S1)
- [x] an old invite with no plan (from `ops/invite.ts`) still gives the standard 60-day trial
- [x] `invite` (operator only) creates the invitation and emails the sign-up link; sending again re-sends it; a used invitation cannot be changed; `revoke` deletes an unused one
- [x] a failed invitation email leaves the invitation in place and says the email failed

### console (T1)
- [x] the Subscriber page offers each action as a small form; a refusal shows the server's words; success reloads the page
- [x] cancelling asks to confirm first
- [x] amounts are typed in kina and sent in toea
- [x] the audit trail shows each change's fields, before → after
- [x] Invites lists invitations (email, plan, trial, expiry, used or not), sends, re-sends and revokes

## S4 - enforcement (T3, T4)
- [ ] the banner text for each status names the amount, the reference and what changes (restricted: "invoices already approved are sent as normal") (moved from S1)
- [ ] the hourly tick does not draft for a restricted org, and logs that it skipped it
- [ ] the hourly tick still requests approval for, sends, and reminds on a restricted org's runs drafted before restriction
- [ ] `draftNow` on a restricted org is refused with a plain message
- [ ] payment lifts restriction; the next tick drafts the current period, held at once if its send time has passed
- [ ] `subscriptionTick` applies `nextSubscriptionStatus` to every subscription, audited as `subscription-tick`
- [ ] `subscriptionTick` recounts `activeTenancyCount` and corrects a drifted count
- [ ] `subscriptionTick` run twice in a day changes nothing the second time
- [ ] T4: a landlord at the limit sees the explanation and "Ask to change plan", not a save error
- [ ] T4: Plan & billing shows plan, usage, dates, bank details and reference; it is a lazy route

## S5 - emails and metrics (T1, T3)
- [ ] each lifecycle email (plan §9) is sent at most once per trigger, claimed with `create()`
- [ ] a failed send leaves the claim unwritten, so the next tick retries it
- [ ] the operator digest is not sent on a day with nothing to report
- [ ] metrics: annual recurring revenue counts active and past_due subscriptions at their locked price, annualised; trials and free count zero
- [ ] the billing CSV lists payments with date, org, amount, bank reference, period covered

## S6 - export, cancel, purge (T3)
- [ ] export contains every CSV and every invoice PDF of the org, and nothing of another org
- [ ] the export link is short-lived and only for that org's owner
- [ ] cancel sets `purgeAfter` = 90 days; runs already approved still send
- [ ] `reinstate` before `purgeAfter` restores the previous status
- [ ] purge copies issued invoices and PDFs to the retention bucket before deleting anything, and stops if the copy fails
- [ ] purge deletes the org tree, the subscription and the user's account; the retention copy remains
