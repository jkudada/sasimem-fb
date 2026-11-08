# Subscribers test list (docs/PLAN-SUBSCRIBERS.md)

Nothing done yet.

Written before the code (plan §9.1 of PLAN-SASIMEM-FB). Ticked as each goes red → green.
Phases S1-S6 match PLAN-SUBSCRIBERS §12; each phase's items land in its PR.

## S1 - core (T1)
- [ ] the three seeded plans have the §3 limits and prices, in integer toea; annual = 10 × monthly
- [ ] a subscription's limit is its `limitOverride` when set, else its plan's
- [ ] `canAddTenancy`: true below the limit, false at it and above it
- [ ] `nextSubscriptionStatus`: a trial before `trialEndsAt` stays trial
- [ ] … a trial at `trialEndsAt` with `paidThrough` in the future becomes active; with none, past_due
- [ ] … active at `paidThrough` becomes past_due, and `pastDueAt` is that instant
- [ ] … past_due before `pastDueAt + graceDays` stays past_due; at it, restricted
- [ ] … past_due or restricted with `paidThrough` in the future becomes active
- [ ] … free never changes on its own; cancelled becomes purged only at `purgeAfter`
- [ ] … is idempotent: applying it twice gives the same status
- [ ] dates are compared in Pacific/Port_Moresby: a trial ending "on the 10th" ends at 00:00 PNG time
- [ ] `extendPaidThrough`: an annual payment adds 12 months from the later of today and the old `paidThrough`
- [ ] … a payment while past due counts from the old `paidThrough`, not from today (no free days)
- [ ] … a month-end `paidThrough` (31 Jan + 1 month) lands on the month's last day
- [ ] a price change applies at renewal only: `priceAtRenewal` uses the plan's current price, a mid-term read keeps the locked one
- [ ] payment references are `SUB-` + 4 digits, sequential, never reused
- [ ] `canDraft(status)`: trial, free, active, past_due → yes; restricted, cancelled, purged → no
- [ ] the banner text for each status names the amount, the reference and what changes (restricted: "invoices already approved are sent as normal")

## S1 - rules (T2)
- [ ] an owner reads their own `subscriptions/{orgId}` and its payments; a stranger reads neither
- [ ] an owner cannot write `subscriptions`, `payments`, `plans`, `operatorEvents` or `signupInvites`
- [ ] an owner cannot read `subscriptions/{orgId}/notes`
- [ ] creating a tenancy at the limit is refused; below it, allowed
- [ ] creating a tenancy with no subscription document is refused (every org has one after the backfill)
- [ ] updating or ending a tenancy at the limit is still allowed
- [ ] an operator with a second factor reads any org, subscription and `operatorEvents`; not `private/*`
- [ ] an `operator` claim without a second factor reads nothing beyond their own orgs
- [ ] an operator writes nothing directly

## S1 - functions (T3)
- [ ] `createOrg` makes a trial subscription: Standard, 60 days, a fresh `SUB-` reference, `activeTenancyCount` 0
- [ ] `createOrg` with the invite's plan `free` makes a free subscription with no trial
- [ ] the count trigger: create +1, set `endDate` in the past −1, delete −1; never below 0
- [ ] `ops/backfill-subscriptions.ts` gives every org without one a free subscription with `limitOverride` = its current count (at least 2), and is safe to run twice
- [ ] `ops/grant-operator.ts` sets `operator: true` and keeps `orgIds`

## S2 - operator console (T1, T4)
- [ ] sign-in without a second factor is sent to MFA enrolment, and sees no data
- [ ] Subscribers lists every org with plan, status, used / limit, dates; each filter narrows correctly
- [ ] Subscriber shows runs, invoices and email log read-only: no button that writes
- [ ] Health shows the last tick, held runs and failed emails across orgs
- [ ] the console bundle shares nothing with the landlord app's sign-in route budget (budget test unchanged)

## S3 - operator actions (T3)
- [ ] every action refuses a caller without `operator` and a second factor
- [ ] `recordPayment` writes the payment, moves `paidThrough`, re-evaluates status, and writes one `operatorEvents` entry with before and after - in one transaction
- [ ] `recordPayment` twice with the same bank reference records it once
- [ ] `changePlan` downgrade below current use keeps every tenancy and blocks new ones
- [ ] `extendTrial`, `setLimitOverride`, `restrict`, `unrestrict`, `cancelSubscription`, `reinstate`, `addNote` each change only what they name and are audited
- [ ] invites carry a plan and trial length; `createOrg` uses them; a used or expired invite is refused

## S4 - enforcement (T3, T4)
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
