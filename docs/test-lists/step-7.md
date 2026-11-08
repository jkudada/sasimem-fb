# Step 7 test list: hardening

Written before the code (plan §9.1). Ticked as each goes red → green.

Where step 7 ends (plan §11 leaves the edges open; chosen here):
- **In:** App Check, enforced on every callable and sent by the app; the ops scripts that
  turn on App Check, budget and tick alerts for a project; Playwright on a throttled
  phone, with a load budget for the sign-in route; the backup restore drill, run on
  `sasimem-dev`; the sending-domain runbook and its DNS checker.
- **Step 8 (or the user):** everything on `sasimem-prod`, the billing budget (a billing
  account, not a project), the real sending domain's DNS, the deploy-on-merge to dev.

Choices the plan leaves open (say if any is wrong):
- **Callables enforce App Check in code** (`enforceAppCheck`, a global option), so no
  callable can be deployed without it. Firestore and Storage enforcement is a project
  setting, turned on by `ops/app-check.ts`. The approval page is not covered: it is a
  link opened from an email, with no JavaScript to fetch a token.
- **The app loads App Check with the data layer** (after sign-in, lazily), so the
  sign-in route carries none of it. Sign-in itself (Firebase Auth) is not covered.
- **Under the emulators the app sends a placeholder App Check token.** The Functions
  emulator skips verification but still refuses a call with no token, so the T4
  journeys prove the app attaches one to every call.
- **The sign-in route's load budget is measured in Playwright, not Lighthouse:** on Slow 4G
  (150 ms, 1.6 Mbps) with the CPU slowed 4×, the form is usable within 4 s and the route
  transfers ≤ 100 KB. One tool fewer, the same throttling.
- **Throttled journeys run nightly, not on PRs**, to keep the PR suite near 5 minutes.
- **The restore drill clones and compares.** It restores the newest backup into a scratch
  database, reads the source at the backup's snapshot time (PITR keeps 7 days), and
  requires every document to match; then it deletes the scratch database. A PITR clone
  drill does the same for an arbitrary time.
- **Alerts:** the tick logs one structured line per successful run; a log-based metric counts
  them; one policy fires on any tick error, one on no success in 3 hours.

## Functions (T3)
- [ ] every callable enforces App Check; the approval page and the tick do not need it
- [ ] the tick logs one "tick done" line with its tally when it succeeds, none when it throws

## Web (T1)
- [ ] App Check starts before the data layer's first Firestore or Functions use
- [ ] with the emulators, the app's App Check token is a placeholder that names the app; real builds use reCAPTCHA Enterprise with the site key from the build
- [ ] a missing site key in a real build is an error at start, not a silent unprotected app

## Ops (T1)
- [ ] app-check: the requests that create a reCAPTCHA Enterprise key for the app's domains, register it, and enforce Firestore, Storage and callables
- [ ] alerts: the log-based metric for a successful tick, the failure policy and the 3-hour absence policy, each named for the project
- [ ] budget: the gcloud command for a $10 budget alert at 50/90/100%, printed for the user
- [ ] restore drill: two document sets match when every path and field is equal; a missing, extra or changed document is named
- [ ] restore drill: the scratch database is named for the date and never `(default)`; it is deleted even when the comparison fails
- [ ] mail DNS: SPF, DKIM and DMARC are judged from TXT/MX answers - present, missing, or wrong (e.g. two SPF records, DMARC without a policy)
- [ ] every ops script refuses a project that is not named on its command line, and refuses `sasimem-prod` unless run with `--i-am-the-owner`

## T4 (Playwright, emulators)
- [ ] a callable called without an App Check token is refused
- [ ] throttled phone (nightly): the sign-in form is usable within 4 s on Slow 4G with a 4× slower CPU, and the route transfers ≤ 100 KB
- [ ] throttled phone (nightly): the four journeys pass

## Run on sasimem-dev (recorded in docs/runbooks)
- [ ] the restore drill: newest backup restored, compared and deleted, with timings
- [ ] App Check: the reCAPTCHA Enterprise key made and registered
- [ ] alerts: the metric and both policies created
