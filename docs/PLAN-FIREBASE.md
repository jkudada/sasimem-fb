# Moving to Firebase - refactor plan

**Status:** superseded by PLAN-SASIMEM-FB.md (a from-scratch TypeScript rebuild). Kept for the reasoning.
**Supersedes, if adopted:** DEPLOY.md §1-§3 and §5. DEPLOY.md §5 argued against
Firestore; this plan accepts the decision to use it and says what it costs to
do it without losing the guarantees that section was worried about.

---

## 1. What changes, in one table

| Piece | Today | On Firebase |
|---|---|---|
| Database | Postgres (Cloud SQL) via the Django ORM | **Cloud Firestore**, Native mode, `australia-southeast1`, via the Admin SDK |
| Web hosting | Cloud Run, its own `*.run.app` URL | **Firebase Hosting** in front, rewriting every path to the same Cloud Run service |
| Login | `django.contrib.auth`, sessions in the database | **Firebase Authentication** (email + password), held in a signed `__session` cookie |
| Frozen PDFs | Cloud Storage via `django-storages` | **Cloud Storage for Firebase** - the same GCS bucket, so almost nothing changes |
| Hourly tick | Cloud Run job + Cloud Scheduler | Unchanged. A scheduled Cloud Function is possible later, but it buys nothing yet (§8) |
| Email | Resend / Postmark | Unchanged |
| Admin | Django admin | Gone. Firestore console + two management commands (§9) |

What does **not** change: Django stays as the web framework. Views, templates,
forms, CSRF, `money.py`, `gst.py`, `periods.py`, `pdf.py` and `mailer.py`'s
rendering all survive. Firebase Hosting cannot run Python, so the server still
runs on Cloud Run. Hosting gives it the CDN, the custom domain and TLS.

What this buys: the Cloud SQL instance was almost the whole bill (DEPLOY.md §4).
Firestore at this scale fits inside its free daily quota, so the running cost
drops from about $13-18/month to about $0-3 plus email. The project does need
the **Blaze** (pay-as-you-go) plan, because Cloud Run and Firestore backups
need billing enabled.

---

## 2. Guarantees we keep, and how

These are the four invariants in the `billing/models.py` docstring, plus the two
locks. Each one moves out of a Postgres constraint and into a document ID or a
Firestore transaction. **The tests for each one move with it, unchanged in what
they assert** (§10).

| Invariant | Today | Firestore |
|---|---|---|
| One invoice per tenancy per period | `UniqueConstraint(tenancy, period)` | The document ID **is** the key: `orgs/{org}/invoices/{tenancyId}_{period}`, written with `create()`, which fails if the document already exists |
| One run per org per period | `UniqueConstraint(org, period)` | `orgs/{org}/runs/{period}` - one document per month, by its name |
| Numbers unique, allocated at approval | `select_for_update` on `Org` in `numbering.py` | One transaction per **run**, not per invoice: read the counter, hand out N numbers, `create()` an `issued_numbers/{number}` document for each one, write the invoices, the counter and the run. This is the `IssuedNumber` idea from PLAN-CONTRACTING §6.2, built now |
| Two taps cannot approve twice | `select_for_update` on `BillingRun` | The same transaction re-reads `run.status`. Firestore retries the losing tap, and the retry sees `approved` and returns. That is the idempotent path that already exists |
| Approval token unique | `unique=True` | `approval_tokens/{token}` → `{org, period}`, created and rotated inside the run's transaction |
| Money is integer toea | `IntegerField` | Firestore integers are 64-bit. A test asserts that no float ever reaches a document (§10) |
| Tenancy with invoices cannot be deleted | `on_delete=PROTECT` | Billed tenancies are **ended, never deleted**. The delete path runs in a transaction that reads `tenancy.invoiced` (set the first time a tenancy is drafted) and refuses |

**Contention on the counter.** Firestore handles about one sustained write per
second on a single document, and a contended counter is its known weak spot.
Allocating a whole run's numbers in one transaction makes it one write per
landlord per month, so the weak spot never comes up.

**Side effects stay out of transactions.** Firestore re-runs a transaction
function when it conflicts, so nothing inside one may send an email or render a
PDF. That changes the shape of `approve_run` (§5.3).

---

## 3. The data model

Everything lives under the organisation. Nothing a landlord owns sits outside
`orgs/{orgId}`, so organisation scoping becomes a path prefix rather than a
`filter(org=...)` that someone can forget.

```
orgs/{orgId}
    name, address, email, gst_registered, gst_number, bank_name, bank_account,
    invoice_prefix, next_invoice_number, timezone, approval_lead_days,
    send_hour, reminder_after_days, reminder_mode, owner_uid, created_at

  properties/{propertyId}
      address, use_type,
      units: [{id, label}]                  # embedded - a handful per property

  tenants/{tenantId}
      name, email, phone

  tenancies/{tenancyId}
      property_id, unit_id, tenant_id,
      tenant_name, unit_label, property_address, use_type,   # denormalised (§3.1)
      rent_toea, start_date, end_date, billing_day, due_days, reference_code,
      invoiced: bool,
      extras: [{id, description, amount_toea, recurrence, period,
                active, gst_treatment}]     # embedded - AdditionalCharge

  runs/{period}                             # "2026-11"; the ID is the constraint
      status, approval_token, approval_expires_at, send_at,
      approval_sent_at, approved_at, sent_at, held_notified_at, created_at

  invoices/{tenancyId}_{period}             # the ID is the constraint
      period, tenancy_id, tenant_id, number, status,
      issue_date, due_date, subtotal_toea, gst_toea, total_toea,
      payment_reference, pdf_path, sent_at, paid_at, paid_note,
      reminded_at, reminders_paused,
      snapshot: {tenant_name, tenant_email, unit_label, property_address},
      lines: [{kind, description, detail, amount_toea,
               gst_applicable, gst_toea}]   # embedded - InvoiceLine

  issued_numbers/{number}                   # existence is the uniqueness
      invoice_id, at

  emails/{autoId}                           # EmailEvent
      kind, to_email, subject, run_period, invoice_id,
      provider_message_id, sent_at

approval_tokens/{token}                     # top level: looked up with no login
    org_id, period

users/{uid}                                 # which org a login belongs to
    org_id
```

### 3.1 What is embedded, what is denormalised, and why

- **Invoice lines live inside the invoice.** They are always read and written
  together, and there are about 1-10 of them. This removes the
  `refresh_from_db` trap in `set_rent_amount`: there is no prefetched copy to go
  stale.
- **Units and additional charges are embedded** for the same reason. A Unit has
  no life of its own, and an `AdditionalCharge` only means something attached
  to its tenancy.
- **The tenant name, unit label and address are copied onto the tenancy and the
  invoice.** The invoice copy (`snapshot`) is not just a workaround for the lack
  of joins. It is the right model: the PDF is frozen at approval, and the
  document's data should be frozen with it. A tenant renaming themselves next
  year must not change last year's invoice row.
- **The tenancy copy has to be maintained.** Editing a tenant's name or a unit
  label updates every tenancy that points at it, in one batch. This is the one
  denormalisation that can drift. It has a single writer function and a test.

### 3.2 Indexes (`firestore.indexes.json`)

| Query | Where it is used | Index |
|---|---|---|
| `runs` where `status == X`, across all orgs | the tick | collection-group, `status` |
| `invoices` where `status == sent` order by `due_date` | `arrears.outstanding` | composite, `status` + `due_date` + `number` |
| `invoices` where `status == sent`, `reminded_at == null`, `reminders_paused == false` | reminders | composite |
| `invoices` where `period == X` | the approval page, the tracking page | single-field (automatic) |

### 3.3 Security rules

The browser never talks to Firestore. Every read and write goes through Django,
using the Admin SDK, which bypasses rules. So the rules are:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

This keeps today's trust model exactly: the server is the only client. If
anyone later proposes reading Firestore from the browser "for speed", that is a
redesign of the security model, not an optimisation, and it gets its own plan.

---

## 4. The seam: a repository layer first, Firestore second

The refactor is safe only if it is done in two moves, with the test suite green
between them:

1. **Introduce `billing/store/`.** Its domain types are plain dataclasses
   (`Org`, `Tenancy`, `Run`, `Invoice`, `Line`, ...), plus one `Store`
   interface with the operations the app actually performs: `get_run(org,
   period)`, `create_invoice_if_absent(...)`, `approve(run, edits)`,
   `outstanding_invoices(org)`, and so on. **First implementation:
   `DjangoStore`, over the existing ORM.** Every module stops importing
   `models` and calls the store instead. Nothing about storage has changed yet,
   so the 204 tests must stay green throughout. When this step is done, the
   ORM is only touched in one file.
2. **Write `FirestoreStore`** against the same interface, and run the same
   suite against it on the Firestore emulator. Cut over with one setting
   (`BILLING_STORE=firestore`). Delete `DjangoStore`, `models.py` and
   `migrations/` only after production has run for a month without needing
   to switch back.

This order matters because it separates the two ways the work can go wrong.
Step 1 can break call sites; step 2 can break storage semantics. Doing both at
once in a 6,600-line app with tax consequences means a red test could be either.

Interface rule: the store returns **domain objects, not documents and not model
instances**. Business logic (`drafting.py`, `arrears.py`, `payments.py`) never
sees a `DocumentSnapshot` or a `QuerySet`. Most of `arrears.py` survives as it
is, because it already groups in Python.

---

## 5. Module by module

### 5.1 `numbering.py`
Deleted as a standalone function. Allocation becomes part of the approval
transaction (§2), since Firestore cannot hold a lock across a helper call the
way `select_for_update` held one across `allocate()`.

### 5.2 `drafting.draft_run`
- `get_or_create` on the run → `runs/{period}.create()`, catching
  `AlreadyExists`.
- `_draft_invoice` → read `invoices/{tenancyId}_{period}`. If it is absent,
  `create()` it. If it is `draft` or `excluded`, rebuild `lines` and the totals
  in a single `update()` guarded by a precondition on `update_time`. If it is
  anything else, leave it alone, as today.
- Stale drafts for ended tenancies: one query on `period`, delete those still
  in `draft`.
- `active_tenancies` → one query on `tenancies`, filtered in Python, as today.

### 5.3 `drafting.approve_run` - the one that changes shape
Today, numbering, the status change and PDF rendering all happen inside one
Postgres transaction. Firestore transactions retry, and a PDF render must not
run inside one. So approval splits into two steps:

1. **Transaction:** re-read the run. If it is already approved, return. Apply
   the landlord's rent edits from the approval page, allocate the numbers,
   create the `issued_numbers` documents, set every included invoice to
   `approved` with `pdf_path = ""`, then set the run to `approved`.
2. **After commit:** for each approved invoice with no `pdf_path`, render the
   PDF from the invoice's own snapshot and lines, and upload it to
   `invoices/{orgId}/{number}.pdf` with `if_generation_match=0`. That
   precondition means **the storage layer itself refuses to overwrite a frozen
   PDF**, which is a stronger guarantee than today's. Then set `pdf_path`.

If step 2 crashes, the invoices are approved and numbered but have no PDF yet.
The tick's send step therefore gains a guard: **render any missing PDF before
sending, and never send an invoice without one.** Re-rendering is safe here
because the input is the frozen snapshot, not live tenancy data.

`views.approve` currently does its edits and its approval under a single lock
(`views.py:130`). Step 1 keeps that property.

### 5.4 `drafting.process_due` - the tick
- Iterating every org stays a plain collection read. It is a few dozen
  documents.
- The status-driven loops use collection-group queries on `runs`.
- **Each transition becomes a compare-and-set:** a transaction that re-reads the
  status and moves `draft → awaiting_approval`, `approved → sent` or
  `awaiting → held` only if the status is still what was read. The email goes
  out after the commit, and only from the tick that won. This is stricter than
  today, where two overlapping ticks could both send an approval request. It
  closes the double-scheduled-run case named in PLAN.md §8.
- `run.invoices.filter(status=APPROVED).update(...)` becomes a batched write of
  at most 500 documents, which is far above any one landlord's month.

### 5.5 `views.py` (approval links, no login)
`_run_for_token` → `approval_tokens/{token}` → `orgs/{org}/runs/{period}`. That
is two reads instead of one query, and it still needs no login. Token rotation
in `reissue_approval` deletes the old token document and creates the new one in
the same transaction, so an old link dies the moment a new one exists, as
today.

### 5.6 `console.py`
- `Count`/`annotate` → Firestore `count()` aggregation queries for the dashboard
  tiles. Unit counts are `len(property.units)`.
- The unit and tenant `exists()` checks → `limit(1)` queries.
- `Org.objects.filter(owner=user)` → `users/{uid}.org_id`. This also leaves
  room for the `Membership` work in PLAN-CONTRACTING §7. That plan's schema
  should be redrawn as `orgs/{org}/members/{uid}` if both plans go ahead.

### 5.7 `payments.py`, `arrears.py`, `mailer.py`
- The paid and unpaid toggles become single-document updates. They keep their
  idempotency checks.
- `arrears.py` changes only its query.
- `mailer.py` writes `emails/{autoId}` instead of `EmailEvent`.

### 5.8 `forms.py`
`ModelForm`s become plain `Form`s whose `save()` calls the store. Validation
from the model `clean()` methods (GST number required when registered, the
recurrence/period rules) moves onto the dataclasses so that it still runs on
every write path, not only on the form.

### 5.9 Management commands
- `seed_demo` writes through the store.
- `run_billing` and `approve_run` change only their imports.
- `render_invoice` reads from the store.

---

## 6. Login: Firebase Authentication

- **Sign-in and sign-up stay server-rendered forms with no JavaScript.** Django
  posts to the Identity Toolkit REST API (`accounts:signInWithPassword` /
  `accounts:signUp`), exchanges the ID token for a **Firebase session cookie**
  with `auth.create_session_cookie` (up to 14 days), and stores it in the Django
  session. The landlord pages "fetch nothing" (`settings.py`). Shipping the
  Firebase JS SDK to a phone on a metered connection would break that for no
  benefit.
- **A small middleware** verifies the session cookie with
  `auth.verify_session_cookie(check_revoked=True)` and sets `request.uid`. This
  replaces `@login_required` with a decorator of the same shape.
- **Password reset:** `auth.generate_password_reset_link()`, sent through our
  own `mailer.py` from the sending domain, so it does not land in spam from a
  generic `firebaseapp.com` address. The six reset templates collapse to two.
- **Existing users cannot keep their passwords.** Firebase imports
  PBKDF2-SHA256 hashes only up to 120,000 rounds. Django 5 uses 870,000 or more,
  and the import fails. Since there is one demo account and at most a handful
  of real landlords, import them without passwords and send each a reset link.
  Do not lower Django's iteration count to make the import fit.
- Dropped from `INSTALLED_APPS`: `admin`, `auth`, `contenttypes`, `sessions`
  (DB-backed). Sessions move to `signed_cookies`, and messages to cookie
  storage.

---

## 7. Hosting: Firebase Hosting in front of Cloud Run

`firebase.json`:

```json
{
  "hosting": {
    "public": "public",
    "rewrites": [
      { "source": "**", "run": { "serviceId": "invoices", "region": "australia-southeast1" } }
    ],
    "headers": [
      { "source": "**", "headers": [{ "key": "Cache-Control", "value": "private, no-store" }] }
    ]
  },
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage":   { "rules": "storage.rules" },
  "emulators": { "firestore": { "port": 8081 }, "auth": { "port": 9099 } }
}
```

Three traps, each of which would fail quietly:

1. **Hosting strips every cookie except one named `__session`.** Django's
   `sessionid` and `csrftoken` would never reach the server, and every POST,
   including the approval button, would fail with a 403. Fix:
   `SESSION_COOKIE_NAME = "__session"` and `CSRF_USE_SESSIONS = True`, so
   everything rides in the one cookie that survives. The signed-cookie session
   holds the Firebase session cookie (about 1 KB), the CSRF secret and flash
   messages, which is comfortably under the 4 KB limit.
2. **Hosting's CDN caches anything that says it may be cached.** An approval
   page carries a credential in its URL. `Cache-Control: private, no-store` goes
   on every response, both in `firebase.json` and in Django middleware, so a
   missing header can never make a landlord's batch public.
3. **Region.** Rewrites from Hosting to Cloud Run are supported only in a list
   of regions, and the docs are inconsistent about whether
   `australia-southeast1` is on it. **This is the first thing to verify (§11,
   step 0)**, before any code moves. If Sydney is not supported: keep Cloud Run
   in Sydney and map the custom domain to it directly, using Hosting only for
   static files. Do not move the server to the US: Firestore stays in Sydney,
   and every request would cross the Pacific twice.

Also: Hosting rewrites time out at 60 s, the same as gunicorn's `--timeout 60`,
so nothing changes there. `CSRF_TRUSTED_ORIGINS` and `SITE_BASE_URL` become the
Hosting domain.

---

## 8. The tick

Keep the Cloud Run **job** with Cloud Scheduler, exactly as in DEPLOY.md. The
reasons there still hold: one image, so the schedule cannot run different rules
from the approval page, and a failure shows up as a failed execution. A
Firebase scheduled function (`scheduler_fn.on_schedule`) would work, since
2nd-gen Python functions run on Cloud Run anyway. But it would be a second
deployable with its own dependency set, and nothing would gain from it.

The job loses its Cloud SQL attachment and gains `roles/datastore.user`.

---

## 9. Without the Django admin

The admin was the support console (PLAN.md §6). It goes away with the ORM.
Replacements, in order of how often they will be needed:

- The **Firestore console**, for reading. Writing there is discouraged because
  it bypasses every validation in §5.8.
- `manage.py support_show <org-or-email>` prints an org's runs, invoices and
  email log.
- `manage.py support_void <invoice>` is the one correction that has to be
  possible and audited.

Anything more is built when a real support request needs it.

---

## 10. Tests

- **Unchanged:** `test_money_and_gst.py`, and most of `test_pdf.py`. They are
  pure functions.
- **Ported:** everything else. It runs against the Firestore and Auth emulators
  (`firebase emulators:exec "manage.py test"`). A base `StoreTestCase` clears
  the emulator between tests with its `DELETE .../documents` endpoint, replacing
  Django's transactional rollback. `factories.py` is rewritten to build
  through the store.
- **New:**
  - Two concurrent `approve()` calls on one run produce one set of numbers.
    Today's lock test, re-asserted against a retrying transaction.
  - Two overlapping `process_due` ticks send one approval request (§5.4).
  - Re-uploading a frozen PDF is refused (§5.3).
  - Send never goes out without a PDF, after a simulated crash between commit
    and render.
  - No float reaches a document: walk every written document in the suite's
    teardown.
  - Renaming a tenant updates every tenancy (§3.1).
  - The `__session` cookie and CSRF work end to end through a request with
    every other cookie stripped (§7).
- **Gate:** the ported suite runs green against both `DjangoStore` and
  `FirestoreStore` before the cut-over. Same assertions, two backends.
- The suite will be slower. The emulator runs over HTTP, so expect minutes
  rather than seconds. Keep the pure-logic tests in a fast tier that needs no
  emulator.

---

## 11. Order of work

| Step | Outcome | Estimate |
|---|---|---|
| 0 | **Spike, half a day:** a Firebase project on Blaze, Firestore in Sydney, Hosting rewriting to a hello-world Cloud Run service in `australia-southeast1`, and a `__session` cookie round trip. Settles §7.3 before anything else is spent | ½ day |
| 1 | `billing/store/` + `DjangoStore`; every module moved onto it; 204 tests green, ORM touched in one file | ~1 week |
| 2 | `FirestoreStore`, emulator test harness, suite green on both backends, new tests from §10 | ~1½ weeks |
| 3 | Firebase Auth: REST sign-in, session-cookie middleware, password reset via `mailer.py`, settings changes from §6-§7 | ~3 days |
| 4 | `firebase.json`, rules, indexes, Dockerfile without `psycopg`/`django-storages`, rewritten DEPLOY.md | ~2 days |
| 5 | Data migration (§12) rehearsed against a copy, then run for real | ~2 days |
| 6 | A month on Firestore with `DjangoStore` still deployable; then delete `models.py`, `migrations/`, `DjangoStore`, and the Cloud SQL instance | later |

About four weeks of work. Step 2 is the one that will overrun, because it is
where Firestore's semantics actually differ.

**Combine with PLAN-CONTRACTING?** Do this first. Phase 0 of that plan
(`Membership`) touches the same scoping code, and building it once on the new
store is cheaper than building it on the ORM and porting it.

---

## 12. Data migration

A one-off `manage.py export_to_firestore`, run with **both** stores configured:

1. Read every row through `DjangoStore` and write it through `FirestoreStore`.
   Keep the Postgres primary keys as document IDs (as strings), so every
   cross-reference survives and the migration can be re-run.
2. Copy `next_invoice_number` exactly, and create an `issued_numbers` document
   for every invoice number already issued. Otherwise the first approval on
   Firestore could re-issue a number.
3. Leave PDFs where they are. `pdf_path` is a storage key and the bucket does
   not change. Only new PDFs use the `invoices/{orgId}/{number}.pdf` layout.
4. **Verify before switching:**
   - document counts per collection equal row counts per table;
   - the sum of `total_toea` per org matches;
   - the set of issued numbers matches;
   - every `pdf_path` resolves.
   The script prints a diff and exits non-zero on any mismatch.
5. Switch over between ticks. Pause the Cloud Scheduler job, take a final
   Cloud SQL backup, migrate, verify, flip `BILLING_STORE`, resume the job.
   Rollback is flipping the setting back, which is safe only until the first
   approval on Firestore. After that, the two numbering sequences diverge.

---

## 13. Backups

Firestore does not back itself up by default. Turn on both of these at create
time, not "later", for the same reason DEPLOY.md §2.3 did:

- **Point-in-time recovery**, giving 7 days of history.
- **A daily scheduled backup** with the maximum 14-week retention.

Both are billed on storage, which is pennies for a few MB of invoices. Restore
a backup into a scratch database once, before go-live, so the restore has been
done at least once before it is needed.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Hosting cannot rewrite to Cloud Run in Sydney | Step 0 spike; fallback in §7.3 |
| An invariant silently weakens in the port | Same tests on both backends (§10); IDs-as-keys rather than queries-then-write |
| Approved invoice stuck without a PDF | Send-time guard, never send without one, rendered from the frozen snapshot (§5.3) |
| Denormalised names drift | One writer function, one test (§3.1); invoices take a snapshot and are meant not to follow |
| Cookie stripping breaks POSTs behind Hosting | `__session` + `CSRF_USE_SESSIONS`, tested with other cookies stripped (§7.1) |
| CDN caches a tokenised approval page | `private, no-store` on every response, twice (§7.2) |
| Support gets harder without the Django admin | Two commands now, more on demand (§9) |
| Lock-in | The `Store` interface is also the way back out; a Postgres store is the one we started with |

---

## 15. Open questions

1. **Is the goal cost, or Firebase specifically?** If it is Firebase-in-the-
   stack, **Firebase Data Connect** (Firebase's managed Postgres, which is
   Cloud SQL underneath) plus Hosting in front of Cloud Run gets there in about
   two days with no data-layer rewrite. It keeps the Cloud SQL bill. This plan
   assumes the goal is Firestore and the lower bill.
2. **Will the browser ever read Firestore directly** (live-updating approval
   page, offline drafts)? If yes, §3.3's deny-all rules become per-org rules
   keyed on `users/{uid}`, and the security model needs its own review.
3. **Does anyone use the Django admin today** for anything §9 does not cover?
