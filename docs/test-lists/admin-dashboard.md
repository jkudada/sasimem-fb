# Admin dashboard test list (docs/PLAN-ADMIN-DASHBOARD.md)

A1 done (2026-11-19). Phases A2-A5 to come. Ticked as each goes red → green.

## A1 - core (T1, `packages/core/src/staff.test.ts`)
- [x] default settings: Managers see no names, rent volume shown, no view-as, summary to every Manager, staff emails kept separate
- [x] a missing or malformed settings document reads as the defaults, key by key
- [x] a settings change names known keys with values of the right type; recipients deduplicated, at most 50
- [x] who changes which setting: S1, S3, S4 the Owner's; S2, S5 also a Manager's; nobody else's
- [x] each role's capabilities with the default settings, and as S1, S2, S3 change them
- [x] subscription actions: notes for all but Viewers, everything else for Owner, Manager, Supervisor
- [x] audit scope: Owners and Managers all, Supervisors their team's, Support their own, Viewers none
- [x] staff actions read from untrusted data: email lower-cased, name trimmed and at most 80, role known, uid safe
- [x] only Owners and Managers manage staff; anyone signs themselves out everywhere
- [x] a Manager manages only Supervisors, Support and Viewers; only an Owner makes or changes an Owner or a Manager
- [x] nobody changes their own access
- [x] there is always an active Owner (also implied by the two rules above, kept as a guard)
- [x] each action fits the target's standing (already staff, not staff, already suspended, not suspended, removed)

## A1 - rules (T2, `tests/rules/staff.test.ts`, subscriptions and invites files)
- [x] each role reads exactly its row of §4 across org profile, records, counter, subscription, payment, note, invite, health, settings
- [x] Managers read customers' names only while S1 is on, and lose them when it goes off
- [x] the Subscribers list's whole-collection reads work for the roles that have them; not for Viewers
- [x] suspended, removed, no second factor, or the old operator claim alone: nothing
- [x] a suspension holds on the very next read (the rules read the record, not the token)
- [x] no role writes customers' data, subscriptions, the audit trail, settings or staff records
- [x] audit trail by role; the Audit log's queries a Supervisor and Support may ask
- [x] staff records: Owners and Managers list them; each person reads their own
- [x] each person sets only their own name and last-seen time (now), while active

## A1 - Functions (T3, `functions/test/staff.test.ts`, operatorAction, invites)
- [x] Supervisors, Support, Viewers cannot list or invite, and no Auth user is made
- [x] a landlord, or staff without their code, is refused
- [x] the list shows role, standing, code set up, last seen
- [x] an Owner invites a Manager: Auth user, staff record, claim, audit entry with actorRole, email with the set-password link back to the console
- [x] a Manager invites Supervisors, Support, Viewers; never an Owner or Manager (and makes no user trying)
- [x] a landlord's email is refused while S5 is on; allowed when off, keeping their orgIds claim
- [x] inviting existing staff is refused; someone removed can be invited again
- [x] a failed email keeps the access; Send again works
- [x] suspend drops the claim and records it; a suspended person can do nothing; reactivate restores the claim
- [x] change role sets the new claim; a Manager cannot touch an Owner; nobody changes themselves
- [x] reset code removes the factors; sign out everywhere is audited
- [x] settings: the Owner turns S1 on, audited before/after; a Manager turns S2 off but not S3 or S4; Viewers nothing
- [x] summary recipients must be active staff
- [x] a staff account cannot create a landlord org while S5 is on
- [x] operatorAction by role: billing roles change subscriptions, Support adds notes only, Viewers nothing, suspended or removed refused; actorRole audited
- [x] the old operator claim with no staff record is refused
- [x] manageStaff and updateSettings capped at 2 instances; manageStaff declares the mail secrets
- [ ] resetMfa against real TOTP factors: the Auth emulator has none; check on dev (A0)

## A1 - ops (`ops/test/subscribers.test.ts`)
- [x] grant-staff's roles are core's; it sets staffRole, keeps orgIds, drops operator; --revoke drops staffRole only
- [x] it writes the record (replaced) and a create-only audit entry; --revoke marks it removed

## A1 - console (T1, `apps/console/src/*.test.ts*`)
- [x] session: staff with a code are in, in their role; no code set up → enrol; code set up but not used → sign in again; no role (or the old claim) → not staff
- [x] signed out after 30 idle minutes, and after 12 hours, saying why on the sign-in screen
- [x] each role's pages; a page the role lacks says so by its address too
- [x] a Viewer lands on Health with only the ticks, and nothing about customers is read
- [x] Support on a subscriber: subscription and a note form only; their own audit entries
- [x] a Manager sees the Organisation section only while S1 is on
- [x] signing in records last seen
- [x] Staff: list, removed only when asked, no actions on your own row, Manager's choices limited, each action sends its own, remove asks first, refusals shown
- [x] Settings: Owner changes any switch at once and the settings reload; Manager's limits greyed with who can; recipients from active staff; refusals shown
- [x] My account: role shown, name saved, sign out everywhere
