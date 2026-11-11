# Subscribers: plans, billing, the operator console

Status: **S1-S3 built** (S1: core rules, rules, `createOrg` trial, tenancy count, ops scripts; S2: the read-only operator console; S3: operator actions, the audit trail, invitations with a plan); S4-S6 to come. Agreed with the user on 2026-11-08 ("go with
your recommendations"). Builds on `docs/PLAN-SASIMEM-FB.md` and
`docs/product.md` §9 (business model), and on `docs/PLAN-TEMPLATES.md` §7
(sign-up by invitation, phase P5).

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | How are subscribers paid for? | **Bank transfer, recorded by the operator.** No card processing: Stripe, Paystack and Flutterwave do not serve PNG (product.md §4) |
| D2 | Plans | **Free** (1-2 tenancies), **Standard** (up to 10), **Plus** (up to 30). Prices in §3; they are data, not code |
| D3 | Billing interval | **Annual by default**, priced at 10 months (2 free). Monthly allowed, billed quarterly in advance to keep transfers few |
| D4 | Trial | **60 days on Standard** for every invited sign-up; no payment details needed |
| D5 | Non-payment | **14 days' grace (past due), then restricted**: no *new* month is drafted. Anything already drafted, approved or sent carries on. Paying lifts it at once |
| D6 | Existing users before billing | Marked **free for good** with their own limit (`limitOverride`). The first landlord ("Suzie Oken") is one |
| D7 | How subscriber invoices are made, first | **Phase A, dogfooding:** a "Sasimem" org in prod bills subscribers as its tenants, with Sasimem's own engine (§5). The user creates it; Claude never touches prod |
| D8 | Later | **Phase B:** a `subscriptionBilling` module with its own `SUB-` numbering and a renewal tick, when Phase A gets tedious (about 20+ paying subscribers) |
| D9 | Operator console | **A separate app** (`apps/console`; `ops/` is taken by the scripts) on its own Hosting site, not a route in the landlord app |
| D10 | Operator access | An `operator: true` custom claim, set only by an ops script; **TOTP MFA required** (Identity Platform upgrade). Starts with the user alone; the model allows more |
| D11 | Support access | **Read-only "view as".** No impersonation that can write. Operator changes go through named, audited callables |
| D12 | Cancellation | 90 days read-only with export, then purge. **Issued invoices and their PDFs are kept 7 years** (to confirm with an accountant) |
| D13 | Order of work | S1-S2 now (independent of templates); S3 after Templates P5 lands, extending its `signupInvites` |

## 2. Rules this work must keep

- **No billing problem interrupts a run.** Restriction only stops step 1 of the
  tick (drafting a new period) for that org. A run already drafted can still be
  approved, sent, reminded and marked paid. A tenant never gets half a month
  because the landlord's subscription lapsed. "Silence never means send" holds
  unchanged.
- **I9 extends to subscriptions.** Plan, status, limits and payments are
  server-write-only. An owner can read their own subscription and nothing else.
- **Every operator change is audited.** One `operatorEvents` document per
  change, written in the same transaction as the change, with before and after.
- **Money stays integer toea (I7)**, prices included.
- **Lifecycle logic lives in `core`**, pure and test-first: the state machine,
  the limit check, renewal dates. Functions only load, call and store.
- **The landlord app's budgets do not move.** The Plan & billing screen is a lazy
  route; the operator console is a different bundle entirely.

## 3. Plans

| Plan | Tenancies | Monthly | Annual (10 × monthly) |
|---|---|---|---|
| Free | 2 | K0 | K0 |
| Standard | 10 | K40 | K400 |
| Plus | 30 | K100 | K1,000 |

Prices are seeded into `plans/{planId}` by `ops/plans.ts` and can be changed
there. A subscription **locks its price** when it starts or renews, so a price
change reaches a subscriber at their next renewal, never mid-term. A 30-tenancy
plan is above the 20-unit limit *per property*; that is fine across properties.

## 4. Lifecycle

```
                 ┌──────────── free (never billed; limit 2, or limitOverride) ───────────┐
invite → trial ──┤                                                                      ├→ cancelled → purged
                 └→ active ⇄ past_due → restricted ─(paid)→ active                        ┘
```

| Status | The landlord can | Changes when |
|---|---|---|
| `trial` | everything, Standard limits | the day after `trialEndsOn`: `active` if paid (`paidThrough` not passed), else `past_due` |
| `free` | everything within the limit | an operator changes the plan |
| `active` | everything | the day after `paidThrough`: `past_due` |
| `past_due` | everything, with a banner and reminder emails | payment: `active`; after `graceDays` (14) days: `restricted` |
| `restricted` | read, export, mark paid, approve and send runs already drafted; **no new period is drafted** | payment: `active`, and the missed period drafts on the next tick |
| `cancelled` | read and export | 90 days pass: `purged` |
| `purged` | nothing (the org is gone; issued invoices are kept in cold storage) | - |

- **Dates, not instants.** `trialEndsOn`, `paidThrough`, `cancelledOn` and `purgeAfter` are
  calendar dates (`"YYYY-MM-DD"`) in Port Moresby time, each the last day covered.
  Past-due and restricted dates are worked out from them, not stored.
- **One pure function decides:** `subscriptionStatus(sub, today)` → status (core).
  The daily subscription tick (§6) applies it; the operator's actions apply it
  straight after recording a payment or changing a plan.
- **Going over the limit** (a plan downgraded below current use) never ends a
  tenancy. It blocks creating new ones until the count is under the limit.
- **A restricted org's missed month.** When payment lands, the next hourly tick
  stops skipping the org and `periodsToDraft` does the rest, unchanged. If the
  send time has passed, the run is drafted and **held at once** (the org has
  earlier runs, so it counts as an outage, not onboarding); the landlord gets the
  held notice and can approve it late, as today. `periodsToDraft` looks at this
  month and next only, so a month missed entirely while restricted is not
  drafted; the landlord can still run it with `draftNow`.

## 5. Billing subscribers

### Phase A: dogfooding (no code)

The user creates an org named "Sasimem" in **prod**, with Sasimem's own business
details, bank account and GST registration (if any; the org's `gstRegistered`
decides whether these are tax invoices). Then for each paying subscriber:

- a **tenant** (the landlord's name and billing email);
- a **tenancy** on a property called "Subscriptions", one unit per subscriber
  (20 units per property, so a second property at 21), rent = the plan's
  monthly price, `referenceCode` = the subscriber's payment reference (`SUB-0042`).

Sasimem then drafts, asks for approval, sends, reminds and tracks payment, exactly
as it does for any landlord. Annual billing in Phase A is a **one-month tenancy**
each year: start and end dates inside the renewal month, rent = the annual
price, so it drafts exactly one invoice. A monthly subscriber is an ordinary tenancy
at the monthly price; quarterly invoicing (D3) waits for Phase B. (A K0 rent with a one-off extra would
also draft a K0 invoice every other month.) Phase B removes the workaround.

The bridge to the operator console: when the user marks a subscription invoice
paid in the Sasimem org, they also **record the payment** in the console (§7),
which moves `paidThrough`. Phase A keeps these two steps by hand. Phase B joins them.

### Phase B: `subscriptionBilling` (later, D8)

- Its own invoices under `subscriptions/{orgId}/invoices/{id}`, its own counter
  (`SUB-` prefix), the same `core` money and GST, a fixed Sasimem PDF layout.
- A renewal step in the daily subscription tick drafts the invoice 30 days before
  `paidThrough`, emails it, and reminds at 7 and 0 days.
- Recording a payment marks the invoice paid and sends a receipt.
- Phase A's open invoices are finished in the Sasimem org; new ones come from Phase B.

## 6. Data model

```
plans/{planId}                     name, tenancyLimit, priceToeaMonthly, priceToeaAnnual,
                                   public (bool), order                     operator-write; signed-in read
subscriptions/{orgId}              planId, status, interval ("annual"|"monthly"),
                                   priceToea (locked), tenancyLimit (copied from the plan,
                                   or limitOverride), limitOverride?,
                                   trialEndsOn, paidThrough, graceDays (14),        # calendar dates or null
                                   cancelledOn, purgeAfter,                          # calendar dates or null
                                   paymentReference ("SUB-0042", null for free), activeTenancyCount,
                                   manuallyRestricted? (S3), createdAt, updatedAt
                                   (+ termsVersion, termsAcceptedAt in S4/P5)
                                                                            server-write; owner read
  payments/{autoId}                amountToea, receivedOn ("YYYY-MM-DD"), method ("bank"),
                                   bankReference, coversFrom, coversTo, recordedBy, at
                                                                            server-write; owner read
  notes/{autoId}                   text, by, at                             operator only
signupInvites/{emailLower}         (from Templates P5) + planId, trialDays, expiresAt, invitedBy,
                                   invitedByEmail, lastSentAt, sendCount, lastError; usedBy, usedAt
                                                                            server-write; operator read
operatorEvents/{autoId}            actor (uid), kind, orgId?, before, after, at
                                                                            server-write; operator read
private/subscriptionCounter        { nextReference }                        server only
```

- **Why a top-level `subscriptions` and not fields on `orgs/{orgId}`:** owners can
  update their org document, so billing fields there would need field-by-field
  rules. A separate server-write-only collection uses the rule pattern already
  used for runs and invoices.
- **The tenancy limit in rules.** Rules cannot count, so a trigger on
  `orgs/{orgId}/tenancies/{id}` (`onTenancyWritten`) **recounts** `activeTenancyCount`
  (tenancies with no `endDate`, or an `endDate` today or later) on every write; a
  recount, not +1/-1, so a lost or repeated event cannot leave it wrong. The tenancy **create** rule adds one
  `get()`: `subscriptions/{orgId}.activeTenancyCount < tenancyLimit`. Two creates
  at the same instant can pass together; the daily tick recounts and the draft
  step re-checks, so the worst case is one tenancy over for a day. A tenancy
  whose end date passes is uncounted by the daily recount.
- **The draft-time check.** Step 1 of the hourly tick skips an org whose status is
  `restricted`, `cancelled` or `purged`, and logs it; `draftNow` refuses the same
  orgs with a plain message. It does not trim tenancies over
  the limit (§4: going over never ends one).
- **Custom claims.** `operator: true` sits beside `orgIds`. Rules: `isOperator()` needs
  the claim **and** `request.auth.token.firebase.sign_in_second_factor`.
  Operators **read** `orgs/**` (not `private/*`), `subscriptions/**`, `operatorEvents`, `plans`;
  they write nothing directly.
- **Indexes (S2):** `subscriptions` by `status` + `paidThrough`; by `status` + `trialEndsOn`.

## 7. Operator console (`apps/console`)

A small Preact + Vite app, sharing `core` and the design tokens, deployed to its
own Hosting site (`sasimem-ops` / `sasimem-ops-dev`) from `firebase.console.json`, so the
main `firebase.json` and the emulators are unchanged. It uses the landlord app's Firebase
web app and App Check key, with the console's domains added to the key. Sign-in requires
a TOTP second factor; the console has no emulator mode, since the Auth emulator has no TOTP.
The Health page reads `system/tick`, which the tick writes after each successful run.

| Screen | Content |
|---|---|
| **Subscribers** | One row per org: name, plan, status, tenancies used / limit, `paidThrough` or `trialEndsOn`, last approval, held runs, email bounces in 30 days. Filters: past due, restricted, trial ending in 14 days, unhealthy |
| **Subscriber** | Org details, subscription, payments, notes, audit trail; their recent runs, invoices and email log read-only ("view as", D11) |
| **Actions** (callables) | `recordPayment`, `changePlan`, `extendTrial`, `setLimitOverride`, `restrict` / `unrestrict` (manual), `cancelSubscription`, `reinstate`, `addNote` |
| **Invites** | Send, resend and revoke invitations with a plan and trial length (extends P5's `ops/invite.ts`) |
| **Billing** | Renewals due in 30 days, past-due list, payments this month; CSV export to reconcile against the bank statement |
| **Health** | Last successful tick, held runs across all orgs, failed and bounced emails, orgs with no approval in 2 months |
| **Metrics** | Subscribers by plan and status, annual recurring revenue (kina), trial → paid conversion, churn by month, invoices sent per month |

Every action goes through **one callable, `operatorAction`** (`{ orgId, action }`), so no
action can skip the guard: it checks the `operator` claim and the second factor (as
`isOperator()` does), reads the action with core's `operatorActionFrom`, applies core's
`applyOperatorAction`, and writes the subscription, any payment or note, and one
`operatorEvents` document (`actor`, `actorEmail`, `kind`, `orgId`, `before`/`after` of the
fields that changed, `detail`) in one transaction. A refusal, or an action that would change
nothing, writes nothing. Invitations go through a second callable, `invite` (send or revoke),
which emails the sign-up link and is audited the same way. `recordPayment` moves `paidThrough` forward by the term
paid for and re-evaluates the status. The term continues from the last day covered
(a trial's end, or the old `paidThrough` while in grace, so grace is not free time),
except when restricted for non-payment, when it starts the day the money arrived (core's
`paymentCovers`). It is worked out as of the day the money **arrived**, so recording it late
costs the landlord nothing. The payment's ID comes from the bank reference (trimmed,
upper-case), so the same transfer recorded twice is one payment.

- **Restricted by hand** is a flag, `manuallyRestricted`, not a status: `subscriptionStatus`
  returns `restricted` while it is set, so the daily recompute keeps it, and `unrestrict`
  clears only that. Free follows the plan (`planId == "free"`), not the stored status, so
  lifting a hand restriction on a free org gives free back.
- **Cancel** sets `cancelledOn` today and `purgeAfter` 90 days on (`CANCEL_DAYS`); **reinstate**
  before then gives back the status the plan and dates say. Purging itself is S6.
- **Changing plan** locks the new plan's price (from `plans/{id}`); leaving free gives the
  org the next `SUB-` reference. A downgrade below use changes no tenancy (§4).

## 8. What the landlord sees

- **Settings → Plan & billing** (lazy route): plan, "7 of 10 tenancies", status,
  paid through / trial ends, Sasimem's bank details and their payment reference,
  their payments, "Ask to change plan" (emails the operator), "Export everything",
  "Cancel subscription".
- **A banner** in the last 14 days of a trial, and while past due or restricted, with
  the amount, the reference and the bank details. Restricted says plainly:
  "Next month's invoices will not be drafted until payment arrives. Invoices
  already approved are sent as normal."
- **At the limit**, the add-tenancy button explains the limit and offers "Ask to
  change plan" instead of failing on save.
- **Sign-up** (with P5): accept the terms of service and privacy notice (version and
  time stored); the "a tool, not an accountant" disclaimer.

## 9. Emails

| To | When | Content |
|---|---|---|
| Landlord | invited | the invitation link, plan, trial length |
| Landlord | signed up | welcome; the three setup steps |
| Landlord | 3 days after sign-up with no tenancy | a setup nudge (once) |
| Landlord | trial ends in 14 and 3 days | how to pay: amount, reference, bank |
| Landlord | renewal due in 30 and 7 days (Phase A: the Sasimem org's invoice does this) | |
| Landlord | past due; restricted | what changes, how to pay |
| Landlord | payment recorded | receipt (Phase B; Phase A: the paid tick) |
| Landlord | cancelled | export link, purge date |
| Operator | daily at 7:00 PNG, if anything to say | new sign-ups, trials ending, past due, restricted, held runs, bounces |

Each is sent at most once per trigger (`subscriptions/{orgId}/notices/{kind_period}`
written with `create()`, as I8 does for reminders) and logged in the email log.

## 10. The daily subscription tick

`subscriptionTick`, scheduled daily at 06:00 Pacific/Port_Moresby, retried, safe
to run twice:

1. For every subscription: `nextSubscriptionStatus` → write the change and an
   `operatorEvents` entry (actor `"subscription-tick"`) if it changed.
2. Recount `activeTenancyCount`.
3. Send the lifecycle emails due (§9), each claimed with `create()`.
4. Purge orgs past `purgeAfter`: export issued invoices and PDFs to the retention
   bucket (7-year lifecycle rule), then delete the org's tree and the user's account.
5. The operator digest.

It logs one "subscription tick done" line; the existing alert pattern (step 7)
gets a second policy for it.

## 11. Export, cancellation, deletion

- **Export everything:** a callable builds a zip in Storage (properties, tenants,
  tenancies, invoices, payments as CSV, plus every invoice PDF) and returns a
  short-lived download, as `invoicePdf` does. Available in every status except
  `purged`.
- **Cancel:** sets `cancelled`, `purgeAfter = now + 90 days`, emails the export
  link. Runs already approved still send. `reinstate` undoes it before purge.
- **Retention:** issued invoices and PDFs go to a separate bucket with a 7-year
  lifecycle and no client access; the operator can restore one on request.

## 12. Phases (each a PR, test-first, stopping for review)

| Phase | Content | Estimate |
|---|---|---|
| S1 ✓ | `core`: plans, `subscriptionStatus`, limit check, `paidThrough` arithmetic, payment references. `plans`, `subscriptions`, `operatorEvents` + rules + rules tests; tenancy-count trigger and the create rule; `createOrg` makes a trial (or free, by flag) subscription; `ops/plans.ts`, `ops/grant-operator.ts`, `ops/backfill-subscriptions.ts` (existing orgs → free, D6) | ~3 days |
| S2 ✓ | `apps/console`: TOTP sign-in and set-up, Subscribers, Subscriber (read-only), Health; `system/tick`; hosting config for dev (deploy waits for TOTP on dev) | ~4 days |
| S3 ✓ | Operator actions (one guarded callable) and the audit trail; the console's Actions forms; Invites with a plan, trial and expiry, emailed (after Templates P5) | ~3 days |
| S4 | Enforcement: the hourly tick skips restricted orgs; `subscriptionTick` steps 1-2; banners, limit message, Plan & billing screen | ~4 days |
| S5 | Lifecycle emails, the operator digest, Metrics, Billing screen and CSV | ~3 days |
| S6 | Export, cancel, reinstate, purge and the retention bucket | ~3 days |
| B | Phase B billing module (D8), when wanted | ~4 days |

About 3½ weeks for S1-S6. Phase A works in prod from the first paying subscriber,
with no code.

## 13. Actions for the user (prod, or account-level)

- **Deploy order for S1** (on any project): `node ops/plans.ts`, then
  `node ops/backfill-subscriptions.ts`, **then** deploy Functions and rules. The new
  tenancy rule refuses an org with no subscription, so backfill comes first.
  See `docs/runbooks/subscribers.md`.

- Create the "Sasimem" org in prod for Phase A (D7), with the business's details.
- Upgrade Firebase Auth to Identity Platform (TOTP MFA) on dev and prod; a small
  cost at this scale. Claude can do dev only with your say-so.
- Run `ops/grant-operator.ts --project sasimem-prod <your email>` when S1 lands.
- Write or approve the terms of service and privacy notice text (S4/P5).
- Confirm the 7-year retention with an accountant (D12).

## 14. Open points (non-blocking)

1. **The seller's GST status.** Whether subscriber invoices are tax invoices
   follows the Sasimem org's `gstRegistered`; nothing in this plan changes.
2. **Exact prices** (§3) are the recommended defaults; changing them is data.
3. **Branch base.** Like the templates work, this sits on the stacked step PRs
   (#3 → #9) until they merge into `main`.
