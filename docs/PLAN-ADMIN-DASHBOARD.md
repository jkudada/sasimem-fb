# Admin dashboard: management stats and staff access

Status: **A1 built** (2026-11-19: roles, staff management, settings, idle sign-out; test list
`docs/test-lists/admin-dashboard.md`). Decisions D1-D8 below; the §11 assumptions were
confirmed by the user on 2026-11-19. A0 (console set-up on dev) waits for the user.

## 1. Goal

Management needs a dashboard that shows how Sasimem is used across all customers (orgs,
properties, tenancies, invoices drafted and sent, email delivery, plans and revenue) so they can
decide where to invest. They must be able to do this **without seeing any customer's
confidential data**: no tenant names, emails, phone numbers, addresses, rent amounts or
invoice contents. Management must also be able to give staff access to the dashboard, change it
and take it away, with the usual admin functions (roles, audit log, MFA, sign-out on idle).

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Who uses it, when? | Other management staff **within a few weeks**. So roles (A1) and the lock-down (A2) ship before anyone but the user gets access |
| D2 | Roles | **Owner, Manager, Supervisor, Support, Viewer** (§4) |
| D3 | Customer names beside their counts | Owner always. Whether Managers see them is an **Owner-only setting** |
| D4 | System-wide rent volume | **Shown**, as one total rounded to K1,000. Owner or Manager can turn it off |
| D5 | "View as" (raw customer data) | Behind a setting **only the Owner can change** |
| D6 | Monthly management summary email | Yes. Recipients default to **all Managers**; the Owner can edit the list |
| D7 | Churn reason | Yes: an optional one-click reason when a landlord cancels |
| D8 | Staff email must differ from any landlord account | Yes, as a setting a Manager (or Owner) can change |

## 3. What exists today, and the gap

The operator console (`apps/console`, PLAN-SUBSCRIBERS §7, S2-S6) already has TOTP sign-in,
Subscribers, Subscriber (with read-only "view as"), Actions, Invites, Billing (CSV), Metrics and
Health; one access level (`operator: true` claim from `ops/grant-operator.ts`); every change
audited in `operatorEvents` through the `operatorAction` callable.

| Gap | Why it matters |
|---|---|
| **Operators can read every org's data.** `firestore.rules` `canRead(orgId) = isMember(orgId) \|\| isOperator()` covers `tenants`, `tenancies`, `invoices`, `emails`, `properties`. | Anyone given access today could read tenant PII and rents. |
| **Metrics are computed in the browser** from raw `orgs/*/runs`. | Needs the broad read above; cost grows with every org; no history. |
| **One role, granted by a script.** | Management cannot manage staff; a revoke waits for the next token refresh (up to an hour). |
| **Not set up on dev** (Identity Platform + TOTP, `sasimem-ops-dev` site, App Check domains). | Needed before anything can be tried on dev. |

Approach: **extend the console.** Staff roles in `staff/{uid}` (checked by rules, so a suspension
is instant), console settings in one audited document, a nightly stats job writing counts only,
and the raw-data read removed from everyone except a "view as" grant the Owner can switch off.

## 4. Roles and permissions

`staff/{uid}`: `role`, `email`, `displayName`, `status: invited|active|suspended|removed`,
`invitedBy`, `createdAt`, `lastSeenAt`. Rules read it on every request. TOTP is mandatory for
every role.

| Capability | Owner | Manager | Supervisor | Support | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| Overview, Growth, Usage, Email delivery, Health (aggregates) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customers table (counts, pseudonym `C-0042`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customer names in that table | ✓ | if S1 on | | ✓ *(assumed, §11)* | |
| Rent volume total | if S2 on | if S2 on | if S2 on | | if S2 on |
| Billing, payments, CSV; record payment, change plan, restrict | ✓ | ✓ | ✓ | | |
| Invites to sign up | ✓ | ✓ | ✓ | ✓ | |
| "View as" a customer (reason required, audited, 30 min) | if S3 on | | | if S3 on | |
| Staff: invite, change role, suspend, remove, reset MFA | ✓ all | ✓ Supervisor, Support, Viewer | | | |
| Audit log | ✓ all | ✓ all | ✓ own team's *(assumed)* | own | |
| Settings S1, S3, S4 (recipients); plans/prices; bank details | ✓ | | | | |
| Settings S2, S5 | ✓ | ✓ | | | |

Guards: at least one active Owner always (the last cannot be removed, suspended or demoted);
nobody changes their own role or status; only an Owner makes or unmakes an Owner or a Manager;
`ops/grant-operator.ts` becomes `ops/grant-staff.ts --role owner` for bootstrap and break-glass.

## 5. Console settings

One document, `console/settings`, written only by the `updateSettings` callable, which checks the
caller's role per key and writes an `operatorEvents` entry (`settingChanged`, before/after).

| Key | Meaning | Default | Who changes it |
|---|---|---|---|
| S1 `managersSeeNames` | Managers see customer names | off *(assumed)* | Owner |
| S2 `showRentVolume` | Rent volume total shown | on | Owner, Manager |
| S3 `viewAsEnabled` | "View as" available at all | off *(assumed)* | Owner |
| S4 `summaryRecipients` | Monthly summary to these staff | `null` = every active Manager | Owner |
| S5 `staffEmailSeparate` | Refuse a staff invite whose email is a landlord member | on | Owner, Manager |

Settings are **enforced by rules, not just hidden in the UI**: names live in
`stats/orgNames/{orgId}` and rent volume in `stats/money/{date}`, and their read rules `get()`
`console/settings` and `staff/{uid}`.

## 6. Confidentiality model

1. **Aggregates by default.** No role reads `orgs/**` any more; `isOperator()` leaves `canRead`.
2. **Per-customer rows hold counts, not content:** pseudonym, plan, status, created month,
   properties, active tenancies, invoices sent (30 d / 12 m), last run month, email failure
   rate, churn-risk flag. Never tenant names, rents or kina per org.
3. **Small-number suppression** in breakdowns: a cell under 3 orgs shows "<3". Overall totals
   are not suppressed.
4. **Rent volume** is one system-wide total, rounded to K1,000, behind S2.
5. **"View as"** (behind S3): the `viewAs` callable checks role and setting, takes a typed
   reason, writes `operatorEvents` (`viewAs`), and creates `viewGrants/{uid}_{orgId}` with
   `expiresAt` 30 minutes on; the org rules allow a read only with a live grant. The daily
   operator digest lists the day's views. Turning S3 off ends live grants at once (rules
   check the setting too).
6. **No third-party analytics.** Everything comes from our Firestore and Auth, kept in
   australia-southeast1.
7. A short **staff data-access policy** and a line in the landlord terms: Sasimem staff see
   usage counts, and may view an account to give support when that is switched on.

## 7. Stats pipeline

Scheduled `statsTick` (daily 05:30 Port Moresby, before `subscriptionTick`), Admin SDK,
idempotent per date:

- Per org, `count()` aggregations: properties, units, active tenancies, tenants; runs and
  invoices by status for this and last month; invoices marked paid; email log sent / failed /
  bounced over 30 days; logo set, layout, overrides, custom numbering, exports used; owner's
  Auth `lastSignInTime` (month only); cancel reason if cancelled.
- Writes `stats/orgs/{orgId}` (counts + pseudonym), `stats/orgNames/{orgId}`,
  `stats/daily/{date}` (totals and breakdowns) and `stats/money/{date}` (rent volume).
- First run backfills monthly history from `runs` (`invoiceCount` per period).
- Pseudonyms are assigned once, in order of org creation, in `stats/orgs/{orgId}.code`.
- Rules: `stats/orgs`, `stats/daily` readable by any active staff; the other two per §5;
  all written only by Functions. An alert fires if `statsTick` misses a day.
- Metrics reads these snapshots; `reports.ts` logic moves into core so job and tests share it.

## 8. Dashboard screens

| Screen | Contents |
|---|---|
| **Overview** | Tiles: active customers, active tenancies, invoices sent this month, email delivery %, ARR/MRR, trials in progress, rent volume (if S2); 12-month sparkline each; "as of" time |
| **Growth** | Sign-ups per month, trial → paid, churn and its reasons, plan mix, upgrades/downgrades, orgs near their tenancy limit |
| **Usage & adoption** | Invoices drafted / approved / sent per month; median days draft → approve; sent on time; reminders; % invoices marked paid; feature adoption; active vs dormant (no run in 60 days) |
| **Email delivery** | Sent, failed, bounced per month and provider; top failure codes (never addresses) |
| **Customers** | §6.2 rows, sort/filter, CSV; names where allowed; "View as" button where allowed |
| **Health** | Existing page plus statsTick heartbeat, function errors, cost vs budget |
| **Staff** | List (role, status, MFA, last seen); Invite, Change role, Suspend/Reactivate, Remove, Reset MFA |
| **Settings** | S1-S5 as toggles / recipient picker, each greyed out for roles that can't change it |
| **Audit log** | `operatorEvents` filtered by person, action, customer, date; CSV |
| **My account** | Name, re-enrol MFA, sign out everywhere |

Idle sign-out after 30 minutes; session at most 12 hours.

## 9. Staff management

- **Invite:** email + role → `manageStaff` creates or finds the Auth user (refused if S5 is on
  and the email belongs to a landlord member), writes `staff/{uid}` `invited`, emails a
  set-password link to the console. First sign-in forces TOTP enrolment (`Enrol` screen), then
  `active`.
- **Change role / suspend / remove:** same callable; updates `staff/{uid}`, the claim (for the
  UI) and `revokeRefreshTokens`. Removed staff keep their doc for the audit trail.
- **Reset MFA:** unenrols factors; the next sign-in re-enrols.
- Every call writes `operatorEvents` (`staffInvited`, `staffRoleChanged`, `staffSuspended`, …).

## 10. Phases

Order changed by D1: the lock-down comes straight after roles, so no one else is given access
while operators can still read every org.

| Phase | Scope | Size |
|---|---|---|
| A0 | Console on dev: Identity Platform + TOTP, `sasimem-ops-dev`, App Check domains (**user steps**, commands via outbox) | user, ~1 h |
| A1 ✓ | Roles: `staff/{uid}`, `isStaff(roles)` in rules, migrate `operator` → Owner, `manageStaff`, `console/settings` + `updateSettings`, Staff, Settings and My account pages, idle sign-out; rules tests for every role × collection | ~4 days |
| A2 | Lock-down: `isOperator()` out of `canRead`; `viewAs` grants behind S3; Subscriber detail rebuilt on grants; data-access policy and terms line | ~2 days |
| A3 | Stats: core stat functions, `statsTick`, backfill, pseudonyms, `stats/**` rules, missed-run alert; churn reason on cancel (D7) | ~3 days |
| A4 | Screens: Overview, Growth, Usage, Email delivery, Customers, Audit log; Metrics on snapshots; suppression; CSV | ~4 days |
| A5 | Monthly management summary email (D6) to S4 recipients, 1st of the month | ~1 day |

Other staff can be invited once A1 + A2 are on dev and prod. Tests follow the existing tiers;
the test list goes in `docs/test-lists/admin-dashboard.md`.

## 11. Assumptions (confirmed 2026-11-19)

1. "Management role" in D3, D4, D6, D8 means **Manager**; the Owner can always do what a
   Manager can.
2. **Supervisor** = the billing and support lead (billing actions, invites, sees team's audit
   entries; no staff management). Billing duties sit with Supervisor since there is no
   Billing role.
3. **Support** sees customer names (to answer the right customer) and does "view as" when S3 is
   on; Owner can "view as" too. Support does not see rent volume (not needed for support).
   Viewer sees aggregates and pseudonyms only, plus rent volume while S2 is on.
4. Defaults: S1 off, S3 off (both opt-in by the Owner), S2 on, S5 on.
5. Summary email recipients: the Owner is not added by default, just Managers (D6 as stated);
   the Owner can add themselves.

## 12. How A1 was built (2026-11-19)

- **Core** `packages/core/src/staff.ts`: roles, `can(role, capability, settings)`, audit scope,
  settings and their editors, staff actions and their guards. The console, the callables and
  the rules all follow it.
- **Rules**: `isStaff(roles)` reads `staff/{uid}` (active, second factor); `isOperator()` is gone.
  Until A2, customers' own records (properties, tenants, runs, invoices, emails) are the
  Owner's alone among staff, as they were the single operator's. The org document (name,
  contact, bank details) is readable by Owner, Supervisor and Support, and Managers while S1
  is on: A3 moves names to `stats/orgNames` and narrows this.
- **Functions**: `manageStaff` (list, invite, resendInvite, changeRole, suspend, reactivate,
  remove, resetMfa, signOutEverywhere) and `updateSettings`; `operatorAction` and `invite`
  check the role; every audit entry carries `actorRole`; `createOrg` refuses a staff
  account while S5 is on. New parameter `CONSOLE_URL`.
- **Console**: pages by role; Staff, Settings, My account; idle (30 min) and 12-hour sign-out;
  where a role may not see names, a customer shows as "Customer" + the first 6 characters of
  its ID until A3's codes.
- **ops**: `ops/grant-staff.ts` replaces `ops/grant-operator.ts`.
- Support can add notes (not in the §4 table, which predates notes): it is the one
  subscription action that helps them help a customer, and it changes nothing.
