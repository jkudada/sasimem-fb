# Sasimem-FB - rebuild plan

**Status:** proposal, nothing built.
**What it is:** a from-scratch rebuild of Sasimem, the rent-invoicing product in
this repository (PLAN.md), in TypeScript on Firebase. It is a new project, not
a port: no Django code is reused, but every product rule is.
**Replaces:** PLAN-FIREBASE.md, which planned a refactor of the Django app and
is no longer the route.

### Assumptions (correct any of these and the plan changes)

| # | Assumption | If wrong |
|---|---|---|
| A1 | Sasimem is this rent-invoicing app, renamed | Rewrite §1-§3 |
| A2 | v1 is the **rent loop only**, matching today's app. The schema leaves room for staff and subcontractor logins (PLAN-CONTRACTING) but does not build them | Contracting roughly doubles the build; roles become the critical path |
| A3 | **Fresh start.** No import from the Django database. An organisation's first invoice number is configurable, so a landlord's existing sequence continues unbroken | Add an import phase (~3 days) |
| A4 | Frontend is **TypeScript + Preact + Vite**, chosen for payload size on metered PNG phones | - |
| A5 | **Hybrid data access:** the browser reads its own organisation's data under security rules and writes plain setup data. Anything touching money state, numbering, approval or sending goes through Cloud Functions | - |
| A6 | Email through **Resend**, from a dedicated sending domain | Swap the adapter (§6.6) |

---

## 1. The product, unchanged

A landlord with 1-20 tenancies sets up their tenants once. Every month the
system drafts the invoices and emails the landlord a single approval link. It
then sends the approved invoices to the tenants on schedule. PLAN.md §1-§5 and
§10 still define the product and are not repeated here. Read them first.

### The rules that define it

1. **Silence never means send.** If the batch is not approved by the send time,
   it is *held*, not sent, and the landlord is told.
2. **Batch approval.** One decision a month, not one per tenant.
3. **Approval needs no login.** Holding a signed, expiring link is the
   credential. Two taps from a phone in a car park.
4. **Phone-first, tiny payloads.** The users are on mid-range Android phones
   with metered data.
5. **A manual override on everything.** Exclude a tenant, change a month's rent,
   pause a reminder.

### The invariants

A rebuild is where these get lost, so they are listed first. Each one has a test
in §9 that must exist before the code it protects.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | One invoice per tenancy per month | Document ID `{tenancyId}_{period}`, written with `create()` |
| I2 | One billing run per org per month | Document ID `runs/{period}` |
| I3 | Invoice numbers are unique, sequential and allocated **at approval**, never at draft | Counter in a server-only document; one transaction per run; an `issuedNumbers/{number}` document per number |
| I4 | Approving twice (two taps, two tabs) allocates numbers once | The approval transaction re-reads status and returns if it is already approved |
| I5 | A PDF is rendered once at approval and **never** regenerated or overwritten | Storage write with `ifGenerationMatch: 0`; rendered only from the invoice's frozen snapshot |
| I6 | Nothing reaches a tenant unless its run was approved, and never twice | Status compare-and-set in a transaction before any send; the send step requires a PDF |
| I7 | Money is an integer number of toea, everywhere | A branded `Toea` type in `core`; a test that no document contains a float |
| I8 | An invoice reminder is sent at most once, ever | `remindedAt` set in the same compare-and-set that claims the send; never cleared |
| I9 | The browser cannot write money state | Security rules: `runs`, `invoices`, `issuedNumbers`, `emails`, `approvalTokens`, `private/*` are server-write-only |
| I10 | An expired or rotated approval link opens nothing but a "request a new link" page | Token document lookup plus an expiry check; rotation deletes the old token |

---

## 2. Architecture

```
            Phone (Preact SPA, ~4 KB framework)        Email link (no JS needed)
                 │ Firebase Auth + Firestore SDK            │
                 │                                          │ HTTPS
       ┌─────────▼────────────────────────────────────────▼───────────┐
       │ Firebase Hosting  - static SPA from the CDN                   │
       │   /a/**  /owed/** ──rewrite──▶ Function `approvalPage`        │
       └─────────┬────────────────────────────────────────────────────┘
                 │ reads (rules)         │ callable Functions (writes)
       ┌─────────▼──────────┐   ┌────────▼───────────────────────────┐
       │ Cloud Firestore    │◀──│ Cloud Functions v2, Node 22, TS    │
       │ australia-se1      │   │ australia-southeast1               │
       │ PITR + daily backup│   │  approvalPage (HTTP, SSR)          │
       └────────────────────┘   │  callables: approveRun, markPaid…  │
                                │  tick (onSchedule, hourly)         │
       ┌────────────────────┐   └────┬──────────────┬────────────────┘
       │ Cloud Storage      │◀───────┘              │
       │ frozen PDFs, logos │                       ▼
       └────────────────────┘                Resend (sending domain)
```

- **Region:** everything in `australia-southeast1` (Sydney), the nearest region
  to PNG. Firestore's location cannot be changed after creation. Pick it
  deliberately on day one.
- **Plan:** Firebase Blaze (pay as you go). Functions, scheduled jobs and
  backups need billing enabled. Expected cost at this scale is about USD 0-3 a
  month plus email. Set a budget alert at $10.
- **Two Firebase projects:** `sasimem-dev` and `sasimem-prod`. Develop against
  the Emulator Suite, not against either project.

### 2.1 Repository layout (pnpm workspaces)

```
sasimem-fb/
  packages/core/        pure TypeScript - no Firebase, no DOM
    money.ts            Toea brand, parse/format kina
    gst.ts              PNG GST rules
    period.ts           "YYYY-MM" months
    billing.ts          drafting rules, the state machine, reminder rules
    types.ts            domain types shared by web and functions
  apps/web/             Preact + Vite + TypeScript SPA
  functions/            Cloud Functions v2 (TypeScript, Node 22)
    src/approval/       server-rendered approval / tracking / owed pages
    src/callables/      one file per callable
    src/tick.ts         the hourly job
    src/pdf.ts          PDFKit renderer
    src/mail/           Resend adapter + plain-text templates
    src/store/          the only code that touches Firestore on the server
  firestore.rules  firestore.indexes.json  storage.rules  firebase.json
  tests/rules/          security-rules tests (emulator)
```

**Why `core` matters:** the browser shows the same totals the server stores
because both import the same arithmetic. It is also the escape hatch. Swapping
Preact for React later touches `apps/web` only (§10).

---

## 3. Domain rules (the spec `core` implements)

These are copied exactly from the current implementation, which has 204
passing tests. Port them as specified, including the rounding.

### 3.1 Money (`money.ts`)

- 1 kina = 100 toea. Every amount is an integer of toea, typed
  `type Toea = number & { readonly __brand: "Toea" }`. Construct one only through
  `toea(n)`, which throws on a non-integer or a value outside
  ±`Number.MAX_SAFE_INTEGER`.
- `parseKina("K1,200.50")` gives `120050`. It strips `K`, commas and whitespace,
  and rejects an empty string. Use string/decimal arithmetic, never
  `parseFloat(x) * 100`: `1.005 * 100` is `100.49999`. Round half up to the toea.
- `formatKina(120050)` gives `"K1,200.50"`, and negatives give `"-K50.00"`.
- The maximum editable amount is K10,000,000.00 (1,000,000,000 toea). Anything
  above it is a validation message, not an error.

### 3.2 GST (`gst.ts`), PNG

- The rate is 10%. `gstOn(amount) = round_half_up(amount × 0.10)` in toea,
  computed in integers as `Math.floor((amount * 10 + 50) / 100)` for
  non-negative amounts. Negative amounts (credits) mirror that, rounding half
  away from zero. Test both signs.
- `isTaxable({ orgGstRegistered, useType, treatment })`:
  - An unregistered org never charges GST, whatever the line says.
  - Treatment `taxable` means taxable, `exempt` means exempt.
  - Treatment `inherit` is taxable if and only if `useType === "commercial"`.
    Residential rent is an exempt supply.
- `documentTitle`: `"TAX INVOICE"` if the org is registered **and** any line is
  taxable, otherwise `"INVOICE"`.
- A GST-registered org must have a GST number. It is a validation error to save
  one without it, because the number is printed on every tax invoice.
- Additional charges default to `inherit`. The UI should say "same as the rent".
  Flag in the UI copy that this is a tool, not an accountant.

### 3.3 Periods (`period.ts`)

- A period is a calendar month, the string `"YYYY-MM"`. That string is part of
  the idempotency keys.
- `day(period, n)` clamps a billing day to the month: the 31st in a 30-day
  month is the 30th, and in February the 28th or 29th.
- `label` is `"October 2026"`. `shortCode` is `"OCT26"`, used in the payment
  reference `"{REFERENCE_CODE}-{shortCode}"`, for example `WARI-OCT26`.
- All scheduling happens in the **org's timezone** (default
  `Pacific/Port_Moresby`, UTC+10, no daylight saving). All storage is in UTC.
  "Today" always means the landlord's calendar day, never the server's. Use
  `Temporal` (with the polyfill) or `date-fns-tz`; never hand-roll offsets.

### 3.4 Drafting (`billing.ts`)

- A tenancy is active in a period if `startDate <= lastDay` and
  (`endDate` is null or `endDate >= firstDay`).
- **Invoice for a tenancy and a period:**
  - `issueDate = day(period, billingDay)` and `dueDate = issueDate + dueDays`.
  - Line 0 is the rent: description `"Rent - {unit}"`, detail
    `"{first day} - {last day} {Month YYYY}"`, amount `rentToea`, and GST per
    §3.2 with `inherit`.
  - Then each additional charge that applies, in the order it was added. A
    recurring (`every`) charge applies every month while it is active, with
    detail = the period label. A `one` charge applies only in its named period.
    Amounts may be negative (credits). Each charge has its own GST treatment.
  - `subtotal = Σ amount`, `gst = Σ line gst` and `total = subtotal + gst`.
    Always recompute these from the lines; never adjust them incrementally.
- **Run send time:** `sendAt = day(period, earliest billingDay among active
  tenancies)` at `org.sendHour` local time, converted to UTC.
- **When a run is drafted:** the tick considers the current and the next period
  in the org's timezone. A period is due for drafting when there is no run for
  it yet, it has at least one active tenancy, and
  `now >= sendAt - approvalLeadDays`. One exception: if `now > sendAt` already,
  draft (and so hold) only if the org has a run for an **earlier** period. That
  case is a scheduler outage. With no earlier run it is onboarding, and
  conjuring a held batch for a month already invoiced by hand would be noise.
- **Redrafting** a run in `draft`, `awaitingApproval` or `held` rebuilds its
  `draft` and `excluded` invoices from current tenancy data. It deletes drafts
  for tenancies no longer active. It never touches an approved or later invoice.
  The hourly tick never redrafts a run that exists. Only an explicit "rebuild"
  does, and it discards manual rent edits, so the UI says so.

### 3.5 The state machine

```
Run:      draft ─request─▶ awaitingApproval ─approve─▶ approved ─sendAt─▶ sent
                                 │   ▲                       
                         sendAt  ▼   │ approve (late)        
                                held ┘                        any pre-approval ─▶ cancelled

Invoice:  draft ⇄ excluded      (landlord unticks / reticks, only while the run is editable)
          draft ─approve─▶ approved ─release─▶ sent ⇄ paid      any ─▶ void (owner, audited)
```

- **Editable** means the run is in `draft`, `awaitingApproval` or `held`.
- **Approving a held run is allowed.** The landlord came back late. It sends at
  the next tick, because `sendAt` has passed. The approval page says so before
  the tap: "This will go out within the hour".
- `paid` is reversible (`markUnpaid`) and emails nobody. Only a `sent` invoice
  can be marked paid. Marking an already-paid invoice paid again is a no-op and
  keeps the original date. Unmarking leaves `remindedAt` alone.

### 3.6 Reminders

An invoice has earned its single reminder on landlord-local day `d` when all of
these hold:

- its status is `sent` and `paidAt` is null;
- reminders are not paused for it, and it has no `remindedAt`;
- the org's `reminderMode` is not `off`;
- `d >= dueDate + org.reminderAfterDays` (default 7).

One reminder, ever. Escalating chases are dunning, which is a different product.

---

## 4. Data model (Firestore)

Everything a landlord owns sits under `orgs/{orgId}`. Organisation scoping is a
path prefix and a rule, not a `where` clause that someone can forget.

```
users/{uid}                         { orgIds: string[] }          server-write only

orgs/{orgId}                        name, address, email, logoPath?,
                                    gstRegistered, gstNumber, bankName, bankAccount,
                                    invoicePrefix ("INV-"), timezone,
                                    approvalLeadDays (3), sendHour (8),
                                    reminderAfterDays (7), reminderMode ("auto"|"off"),
                                    createdAt
  members/{uid}                     { role: "owner", addedAt }    server-write only
                                    # v1 has owners only; this is where staff and
                                    # subcontractors go later (PLAN-CONTRACTING §7)
  private/counter                   { nextInvoiceNumber }         server only, not even readable
  properties/{propertyId}           address, useType ("residential"|"commercial"),
                                    units: [{ id, label }]
  tenants/{tenantId}                name, email, phone
  tenancies/{tenancyId}             propertyId, unitId, tenantId,
                                    tenantName, unitLabel, propertyAddress, useType,  # denormalised
                                    rentToea, startDate, endDate?, billingDay, dueDays,
                                    referenceCode, invoiced (bool, server-set),
                                    extras: [{ id, description, amountToea, recurrence,
                                               period?, active, gstTreatment }]
  runs/{period}                     status, sendAt, approvalExpiresAt, approvalSentAt,
                                    approvedAt, sentAt, heldNotifiedAt, createdAt,
                                    totalToea, invoiceCount                       # server only
  invoices/{tenancyId}_{period}     period, tenancyId, tenantId, status, number?,
                                    issueDate, dueDate, subtotalToea, gstToea, totalToea,
                                    paymentReference, pdfPath, sentAt, paidAt, paidNote,
                                    remindedAt, remindersPaused, documentTitle,
                                    snapshot: { org: {...letterhead, bank, gst},
                                                tenantName, tenantEmail, unitLabel,
                                                propertyAddress },
                                    lines: [{ kind, description, detail, amountToea,
                                              gstApplicable, gstToea }]          # server only
  issuedNumbers/{number}            { invoiceId, at }                             # server only
  emails/{autoId}                   kind, to, subject, runPeriod?, invoiceId?,
                                    providerMessageId, sentAt, status             # server only
  events/{autoId}                   actor (uid | "approval-link" | "tick"), kind, at,
                                    target, note                                  # audit trail

approvalTokens/{token}              { orgId, period, expiresAt }   server only, never client-readable
```

Notes:

- **Dates.** Calendar dates (`startDate`, `issueDate`, `dueDate`) are `"YYYY-MM-DD"`
  strings, because they are the landlord's dates, not instants. Instants
  (`sentAt`, `paidAt`) are Firestore `Timestamp`s.
- **The snapshot.** It freezes everything printed on the invoice at approval
  time, the org's letterhead and bank details included. The PDF and every later
  email use the snapshot only. Changing the org's bank account changes future
  invoices, never issued ones.
- **The denormalised fields on a tenancy.** Tenant name, unit label, address and
  use type are maintained by one Function trigger (`onDocumentUpdated` on
  tenants and properties) and covered by one test.
- **Deleting a tenancy.** It may be deleted only while `invoiced == false`. A
  billed tenancy is ended (`endDate`), never deleted. That is a rule, not just
  UI.
- **The first invoice number.** `private/counter` is seeded at org creation from
  a "first invoice number" field (default 1). This is how a landlord who already
  issued INV-0141 by hand continues at INV-0142 (A3). It is settable only
  before the first approval.

### 4.1 Indexes

| Query | Where | Index |
|---|---|---|
| `runs` where `status == X`, across orgs | tick | collection-group on `status` |
| `invoices` where `status == "sent"` order by `dueDate`, `number` | arrears | composite |
| `invoices` where `status == "sent"` and `remindedAt == null` and `remindersPaused == false` | tick, reminders | collection-group composite |
| `invoices` where `period == X` | approval and tracking pages | automatic |

---

## 5. Security rules

- **Read:** a signed-in user may read `orgs/{orgId}/**` if
  `exists(/orgs/{orgId}/members/{uid})`, except `private/*`, which nobody reads.
  `approvalTokens` and `users` are not client-readable at all. (A user's org
  list arrives through a callable or from custom claims. **Recommendation:**
  set `orgIds` as a custom claim when the org is created. That saves a read per
  rule check.)
- **Write, client:** owners may create, update and delete `properties`,
  `tenants` and `tenancies`, and update the org profile. Every write is
  validated in the rules: types, enums, integer toea, string lengths,
  `billingDay` 1-31. `invoiced` and the denormalised fields are immutable from
  the client. A tenancy delete is allowed only when `invoiced == false`.
- **Write, server only:** everything else. Its rule is `allow write: if false`,
  and Functions use the Admin SDK.
- **Storage:** PDFs are not readable by clients. The SPA downloads one through a
  callable that returns a short-lived signed URL, after checking membership.
  Logos are readable by members and writable by owners, `image/*` only,
  ≤ 200 KB.
- **App Check (reCAPTCHA Enterprise).** Turn it on for Firestore, Storage and
  callables before launch.

**Rules tests are not optional.** `@firebase/rules-unit-testing` against the
emulator must cover:

- a stranger reading another org;
- an owner writing `runs` or `invoices` directly;
- an owner editing `invoiced` or the counter;
- a float in `rentToea`;
- deleting an invoiced tenancy.

---

## 6. Server: Cloud Functions

All Functions run in `australia-southeast1` under one service account with
least privilege. Secrets (`RESEND_API_KEY`, `APPROVAL_SIGNING_KEY`) come from
`defineSecret`, never `.env` in git.

### 6.1 The approval page: `approvalPage` (HTTP, server-rendered)

This is the most-used screen, so it gets the most care.

- `GET /a/{token}`:
  - Look up `approvalTokens/{token}`, check `expiresAt`, load the run and its
    invoices, and render **one HTML page with inline CSS and no required
    JavaScript**. Target ≤ 30 KB transferred.
  - Each tenant gets a row: name, unit, payment reference, editable rent, and an
    include/exclude checkbox. Then a running total and one **Approve** button.
  - A small inline script (≤ 2 KB, optional) keeps the total live while typing.
    The server re-parses and re-totals every value regardless.
- `POST /a/{token}`: one transaction that applies the rent edits and exclusions,
  then approves (§6.3). It redirects to the same URL, which now shows "Approved
  - goes out {date, local time}".
- **After the batch is sent**, the same link becomes the **tracking page** for
  that month: who has paid, with a reversible "paid" tick that emails nobody.
- `GET /a/{token}/owed` is the **arrears page**: everything unpaid across every
  month. It is reachable only from a link that was actually emailed to the
  landlord.
- **Expired or rotated tokens** get a page offering "email me a fresh link". The
  fresh link always goes to the org's address on file, never to an address the
  visitor supplies.
- **Headers on every response:**
  - `Cache-Control: private, no-store`, because the URL is a credential and
    Hosting's CDN must never cache it;
  - `Referrer-Policy: no-referrer`;
  - `X-Robots-Tag: noindex`;
  - a strict CSP.
- **CSRF.** There is no cookie, so cookie CSRF does not apply. The POST must
  carry the token in the path **and** a per-render nonce that is signed with
  `APPROVAL_SIGNING_KEY` and expires in 30 minutes.
- **Nothing on this page can send.** It can only move a run to `approved`. The
  tick releases the batch at `sendAt`. A bug here cannot put an invoice in front
  of a tenant early.

### 6.2 Callables (signed-in owner; each re-checks membership)

| Callable | Does |
|---|---|
| `createOrg` | Creates the org, the owner membership, the counter (seeded from the first number), and the custom claim |
| `draftNow(period)` | "Generate this month's invoices now". Drafts and requests approval immediately |
| `rebuildRun(period)` | Explicit redraft. Warns that manual edits are discarded |
| `setRent(invoiceId, toea)`, `exclude` / `include(invoiceId)` | Only while the run is editable |
| `approveRun(period)` | Approval from the console, the same code path as the page |
| `reissueApproval(period)` | Rotates the token and emails the org address |
| `markPaid(invoiceId, note?)`, `markUnpaid`, `pauseReminders(invoiceId, bool)` | Payment ticks and the reminder switch |
| `voidInvoice(invoiceId, reason)` | Owner only, written to `events` |
| `pdfUrl(invoiceId)` | Signed URL, 5 minutes |
| `exportCsv(from, to)` | The only accounting export (PLAN.md rec. 7) |

### 6.3 Approval, step by step

1. **Transaction.**
   - Read the run. If it is `approved` or `sent`, return it unchanged (I4). If
     it is not editable, refuse.
   - Read the counter. Give out numbers to the included invoices in a stable
     order (tenant name, then tenancy ID), as `prefix + zero-pad(4)`.
   - `create` an `issuedNumbers/{n}` document for each one.
   - Set each invoice to `approved` with its number, its snapshot and
     `pdfPath: ""`. Set excluded invoices aside untouched.
   - Bump the counter, set the run to `approved` with `approvedAt`, and write an
     `events` entry.
   - No I/O happens inside this function. Firestore may run it more than once.
2. **After commit.** For each approved invoice without a `pdfPath`, render the
   PDF from its snapshot and upload it to `invoices/{orgId}/{number}.pdf` with
   `ifGenerationMatch: 0` (I5). Then set `pdfPath`. A 412 response means it
   already exists, so record the path and move on.
3. If step 2 crashes, the tick's release step renders any missing PDF before
   sending, and **never sends an invoice without one**.

### 6.4 The tick: `tick` (onSchedule `every 60 minutes`, retries on)

The steps run in this order, and every step is safe to run twice or
concurrently:

1. **Draft** the periods that are due (§3.4), for every org. Use `create()`
   for runs and invoices; `AlreadyExists` counts as success.
2. **Request approval.** For each `draft` run whose time has come, run a
   compare-and-set transaction `draft → awaitingApproval`: create the token,
   set the expiry to 7 days, and set `approvalSentAt`. Then, outside the
   transaction and only from the tick that won, email the digest:
   `"5 invoices ready for October - K6,400.00"`.
3. **Release.** For each `approved` run with `now >= sendAt`:
   - Ensure every PDF exists.
   - Run a compare-and-set `approved → sent` that also marks its invoices
     `sent` with `sentAt` (batched, ≤ 500).
   - Then email each tenant their PDF, logging each send to `emails`.
   - Then send the landlord a dispatch notice ("Sent - October invoices are with
     your tenants"), unless the batch was empty.
   - Sending after the commit means a crash can lose an email, which shows up in
     the email log as missing and can be resent. It can never double-send.
     That trade is deliberate.
4. **Hold.** For each `awaitingApproval` run with `now >= sendAt`, run a
   compare-and-set to `held` that restarts the token expiry for another 7 days.
   Then email "Held: October invoices were not sent", carrying the same link.
5. **Remind.** For each invoice that has earned it (§3.6), run a compare-and-set
   that sets `remindedAt`, then email the tenant. This is last, because nothing
   about it is urgent.

The tick returns and logs a tally (`{drafted, requested, sent, held, reminded}`).
A thrown error must fail the execution visibly, not be swallowed.

### 6.5 PDF (`pdf.ts`)

- Use PDFKit with the built-in Helvetica and Times fonts and no embedded fonts,
  so a typical invoice is about 3-10 KB. **Budget: ≤ 150 KB including a logo.**
  Downscale uploaded logos server-side to ≤ 400 px.
- One A4 page:
  - the letterhead, with the logo or a monogram of the org's initials;
  - `INVOICE` or `TAX INVOICE`;
  - the number, issue date and due date;
  - the GST number when registered;
  - "Bill to" with the tenant and unit;
  - the lines, each showing a GST column only when any line is taxable;
  - subtotal, GST and total;
  - the bank details and the payment reference in large type.
- A golden-file test renders a fixed invoice and compares the extracted text.

### 6.6 Email (`mail/`)

- A `Mailer` interface with Resend and console implementations. The emulator
  and tests use the console one.
- Every message has a plain-text body (HTML is optional) and is logged to
  `emails` with the provider's message ID.
- The sender is `invoices@<sending domain>`, with SPF, DKIM and DMARC set
  before the first real send (PLAN.md rec. 3). Reply-To is the landlord's
  email.
- Templates:
  - approval digest;
  - held notice;
  - dispatch notice;
  - tenant invoice, with the PDF attached;
  - tenant reminder;
  - fresh approval link.

---

## 7. Frontend: Preact + Vite + TypeScript

- **Libraries:**
  - `preact`;
  - `@preact/signals` for state;
  - `preact-iso` for routing and lazy routes;
  - Firebase JS SDK, modular imports only.
  - Enable `preact/compat` aliasing only if a library needs it.
  - No UI kit. Plain CSS with tokens, mobile-first.
- **The payload is the Firebase SDK, not Preact.** Auth plus Firestore is most
  of the JavaScript. Budgets, enforced in CI with `size-limit`:
  - sign-in route: **≤ 70 KB gzip**;
  - signed-in app shell: **≤ 160 KB gzip**;
  - approval page: **0 KB required**.

  Ways to stay inside them:
  - Lazy-load Firestore after sign-in.
  - Use `firebase/firestore/lite` on screens that need no live updates.
  - Load App Check after first paint.
- **Offline.** Turn on Firestore persistent cache, so a landlord with patchy
  signal still sees their tenants. Writes made offline queue and sync. Callables
  need a connection, and the UI says so plainly.
- **Screens (v1):**
  1. Sign up, sign in, reset password (Firebase Auth, email and password).
  2. Onboarding: org details, GST, bank, first invoice number, then the first
     property, tenant and tenancy.
  3. Home: this month's run status, with the one action that matters now
     ("Review 5 invoices", "Held - approve now", "All paid"), plus amount owed.
  4. Properties and units; tenants; tenancies, with additional charges.
  5. Invoices: by month, with a status chip, paid tick, PDF link and reminder
     pause.
  6. Owed: arrears across months, oldest debt first, grouped by tenant.
  7. Settings: letterhead, logo, bank, GST, timing (lead days, send hour,
     reminder days and mode).
- **The UI never computes a stored total.** It shows `core`'s numbers for
  previews and the server's stored numbers for anything issued.
- **Accessibility:**
  - one-handed reach for primary actions;
  - tap targets of at least 44 px;
  - works at 320 px wide;
  - copy in plain English with no jargon. Say "Waiting for you", not
    "AWAITING_APPROVAL".

---

## 8. Hosting

`firebase.json` serves `apps/web/dist` with an SPA fallback, rewrites the
approval paths to the Function, and sets headers:

```json
{
  "hosting": {
    "public": "apps/web/dist",
    "rewrites": [
      { "source": "/a/**", "function": { "functionId": "approvalPage", "region": "australia-southeast1" } },
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      { "source": "/a/**", "headers": [{ "key": "Cache-Control", "value": "private, no-store" }] },
      { "source": "/assets/**", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
      { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
    ]
  }
}
```

- **Verify in the step-0 spike** that a Hosting rewrite to a Function in
  `australia-southeast1` works. Google's documentation on supported rewrite
  regions has been inconsistent. **Fallback:** deploy only `approvalPage` to
  `us-central1`. That adds roughly 150 ms to one page, which is acceptable, and
  Firestore stays in Sydney.
- **Cookies.** Hosting strips every cookie except `__session` on rewritten
  requests. The approval page uses no cookies, by design, so this does not bite.
  Keep it that way.
- **Custom domain** on Hosting, with automatic TLS. `APP_BASE_URL` is used to
  build the links in emails.

---

## 9. Test-driven development, and tests that stay fast

The whole product is built test-first. Speed is the second goal: a suite that
takes 20 minutes stops being run, and then it stops being TDD. The rule
throughout is **fast by design, not by skipping**. Anything slow is moved off
the merge path, never deleted.

### 9.1 How every change is written (red, green, refactor)

1. **Write a test list first.** Before touching code for a task, write the
   behaviours it needs as a checklist of one-line test names in the PR
   description or a scratch file. Start with the simplest case, and add
   behaviours to the list as you discover them. Do not keep them in your head.
2. **Red.**
   - Write **one** failing test for the next item on the list.
   - Run it and **see it fail for the right reason**: an assertion failure, not
     an import error or a typo.
   - A test that passed first time has proved nothing. Make it fail by breaking
     the code once.
3. **Green.** Write the least code that passes. Hard-coding is allowed here;
   the next test will force the generalisation (triangulation).
4. **Refactor**, with all tests green:
   - remove duplication, name things well, and move rules into `core`;
   - change structure only, never behaviour;
   - refactor tests too, since they are code.
5. **Commit at green.** Small commits, each with a passing suite, so any commit
   can be reverted or bisected.
6. **Every bug fix starts with a failing test** that reproduces it. The test
   stays forever, named after the behaviour, not the ticket.

**Rules for the tests themselves:**

- **One behaviour per test.** The name reads as a sentence in the domain's
  language, for example `holds the batch when send time passes without
  approval`. Avoid names like `test_status_3`.
- **Arrange, act, assert.** One act per test. Prefer one logical assertion;
  several `expect`s about the same outcome are fine.
- **Test through public behaviour, not internals.** A test for `core` calls
  exported functions. A Function test calls the callable or HTTP endpoint and
  checks Firestore and the mailer. If a refactor breaks a test without changing
  behaviour, the test was coupled to implementation; fix the test.
- **Fakes at the boundaries, real code inside.** Fake only what crosses a
  process or network boundary:
  - the clock: inject `now`;
  - the mailer: use the in-memory `FakeMailer`;
  - randomness: inject a token generator.
  Use the real emulators for Firestore, Auth and Storage; mocking Firestore
  tests the mock. Never mock `core` from a Function test.
- **Deterministic or deleted.** No real time, no network outside the emulators,
  no ordering between tests, no shared mutable fixtures. A test that fails
  intermittently is a bug and gets fixed or quarantined within a day (§9.5).
- **Builders, not fixtures.** `aTenancy().commercial().withRent("K1,200").build()`
  in `packages/core/testing`. Each test states only what matters to it.
- **Tests are the spec of the invariants.** I1-I10 each have a named test file
  (`invariants/I3-numbering.test.ts`) written **before** the code that
  satisfies it.

### 9.2 Tiers and their time budgets

Most tests are pure and run in milliseconds. Only what genuinely needs
Firebase touches an emulator. Each tier has a budget, and CI fails a tier that
exceeds its hard cap (`timeout-minutes`). A tier that drifts past its target is
a task to fix, not something to live with.

| Tier | What | Tool | Volume | Target | Hard cap |
|---|---|---|---|---|---|
| T1 Unit | `core` rules (§3); Preact components and signals | Vitest (`happy-dom`), `@testing-library/preact` | Hundreds; most of the suite | **< 10 s** | 1 min |
| T1p Property | Money, GST, periods, drafting totals | `fast-check` in Vitest | ~20 properties × 200 runs on PRs | < 15 s | 1 min |
| T2 Rules | Every item in §5 and I9 | `@firebase/rules-unit-testing` + Firestore emulator | ~60 | < 30 s | 3 min |
| T3 Integration | Callables, approval page, tick, PDF, I1-I8 and I10 | Vitest + Firestore, Auth and Storage emulators | ~150 | **< 90 s**, sharded | 5 min |
| T4 E2E | 4 critical journeys (below) | Playwright, Chromium only, 360 × 740 | 4-6 | < 2 min, sharded | 6 min |
| Budgets | JS size (§7), PDF ≤ 150 KB | `size-limit`, one T3 test | - | < 30 s | 2 min |

The T3 cases that must exist, by invariant:

- two concurrent `approveRun` calls produce one set of numbers;
- two overlapping ticks send one digest, and one email per tenant;
- re-uploading a frozen PDF is refused;
- after a crash between approval and rendering, the invoice is still sent with
  a PDF;
- held, then a late approval, then sent;
- expired and rotated tokens;
- no float in any written document.

**T4 journeys only, nothing else end to end:**

1. Onboarding to first draft.
2. Approve from the email link **with JavaScript disabled**.
3. Tick past send time, check the tenant emails and PDFs, then mark paid.
4. An expired link leads to a fresh-link request.

Everything else is proven at T1-T3, where it is fast and precise. A new E2E test
needs a reason that no lower tier can cover.

**Ratio guard.** If T3 or T4 grows faster than T1, logic is leaking out of
`core` into Functions or components. Move it back.

### 9.3 Making the slow tiers fast

- **Isolation without teardown.**
  - Every T3 test creates its own org with a random `orgId`, and asserts only
    under that org. Tests never clear the database, never share data, and can
    run concurrently.
  - Collection-group queries in the tick take an optional `orgIds` filter for
    tests, so one test's tick never sees another's runs.
  - Each Vitest worker uses its **own emulator project ID**
    (`demo-sasimem-${VITEST_POOL_ID}`). The emulator keeps project IDs
    separate, so workers cannot collide even in collection-group queries.
- **Run in parallel.**
  - Vitest worker threads within a job.
  - Shard T3 and T4 across GitHub runners (`--shard=1/3`).
- **Start the emulators once per job, not per file.** Use one `globalSetup`.
  Use `firebase emulators:exec` only in CI. Locally, keep the emulators
  running in a separate terminal and the tests just connect.
- **Use the clock, never sleep.** The tick, expiry and reminders are tested by
  passing `now`. No `setTimeout` or polling in tests. Playwright waits on
  conditions only; `waitForTimeout` is banned by a lint rule.
- **Cache.** In CI, cache the pnpm store, the emulator JARs
  (`~/.cache/firebase/emulators`), the Playwright browsers and the Vite build
  output between jobs (upload once, download in E2E).
- **Slow-test alarm.**
  - Vitest's `slowTestThreshold` is 50 ms for T1 and 2 s for T3.
  - The CI summary lists the ten slowest tests.
  - A T1 test over 100 ms fails. It is secretly an integration test, so move it.

### 9.4 Where tests run

**Local inner loop (seconds):**

- `pnpm test:watch` runs T1 for changed files only (Vitest's related-files
  mode). This is the red-green-refactor loop. It must stay under 2 s per
  save.
- `pnpm test:int path/to/file` runs one T3 file against already-running
  emulators.

**Pre-push hook (< 30 s):** typecheck, lint and T1 for the whole repo, using
`lefthook`. It never runs emulators, so pushing stays fast. CI runs the rest.

**Pull request (GitHub Actions; target ≤ 5 min wall clock, hard cap 8):** all
jobs start at once, with `concurrency: cancel-in-progress` per branch.

```
 ┌ lint + typecheck ─────────┐  ~1 min
 ├ T1 + T1p (unit, property) ┤  ~1 min
 ├ T2 rules ─────────────────┤  ~1½ min  (incl. emulator start)
 ├ T3 shard 1/3 ┬ 2/3 ┬ 3/3 ─┤  ~3 min each, in parallel
 └ build + size-limit ──▶ T4 shard 1/2 ┬ 2/2 ┘  ~2 + 2 min
                                              ⇒ ≈ 4-5 min to green
```

All of these are **required status checks** under branch protection, and
`main` accepts only merges with every check green. There is no "affected
packages only" shortcut on PRs: the full suite fits the budget, and partial runs
are how invariants break unnoticed.

**On merge to `main`:** the same suite, then deploy to `sasimem-dev`.

**Nightly (off the merge path, quality without the wait):**

- **Mutation testing** on `packages/core` with Stryker (incremental mode). Gate:
  a mutation score ≥ 80%, and **100% on `money.ts` and `gst.ts`**. A surviving
  mutant in tax arithmetic means a missing test.
- **Property tests at high iteration:** 10,000 runs per property, with a fixed
  seed logged so any failure is reproducible.
- **E2E matrix:** Chromium, WebKit and Firefox at 360 px with Slow 4G
  throttling, plus a Lighthouse budget check on the sign-in route.
- **Flake detector:** T3 and T4 run 5× with randomised order. Any test that
  disagrees with itself becomes an issue.
- A nightly failure opens a GitHub issue automatically and blocks the next
  production deploy, not merges.

**Before a production deploy (manual, from a tag):** the nightly suite must be
green for that commit, then a smoke test against `sasimem-dev`.

### 9.5 Quality gates that do not cost merge time

- **Coverage** is reported, never a target to game.
  - Floors: `core` ≥ 95% branches, `functions` ≥ 85% lines.
  - The PR fails only if a change *lowers* coverage of a touched file.
  - Mutation score (nightly) is the real measure of test quality.
- **Flaky tests:**
  - No automatic retries in T1-T3.
  - T4 allows one retry, but a test that passed on retry is reported as flaky
    on the PR.
  - A flaky test is fixed or moved to a `quarantine` project, which runs
    nightly and is not required, within 24 hours, with an issue opened.
  - Quarantine is time-boxed to a week; after that, fix the test or delete it
    and the behaviour it was guarding goes back on the test list.
- **Skipped tests.** `.only` and `.skip` fail lint. A `todo` test is allowed and
  shows in the summary.
- **Reviews check the tests first.** A reviewer reads the test diff before the
  code diff. A behaviour change with no test change is sent back.

### 9.6 Time travel

Every function that depends on time takes `now` as a parameter, defaulting to
the clock. Tests never depend on the real date. The current app learned this the
hard way.

---

## 10. Recommendations

1. **Build `core` and its tests first, before any Firebase code.** It is the
   product's arithmetic and rules. It is cheap to get right in isolation and
   expensive to debug through an emulator.
2. **Work test-first, and keep the suite fast (§9).** Write the invariant tests
   (I1-I10) before the code they protect; a rebuild loses guarantees silently,
   and the tests are how you notice. Hold the PR suite to about 5 minutes by
   pushing logic into fast `core` tests, not by running fewer tests.
3. **Keep the approval page server-rendered and JavaScript-free.** It is the
   screen that matters most, and the SPA is not the right tool for it.
4. **Keep screens thin.** No business rule lives in a component. This keeps
   React a few-day swap away if Preact ever pinches.
5. **Turn on Firestore PITR and daily backups (14-week retention) when the
   database is created.** Restore once into a scratch database before
   launch. These are tax documents.
6. **Run the current Django app in parallel for one billing month** on the same
   landlord's data before switching (PLAN.md rec. 1, again). Compare every
   invoice line by line. Retire the old app only after a clean month.
7. **Do not let the browser call Resend, render PDFs or touch the counter, ever.**
   If a feature seems to need it, it needs a callable.

---

## 11. Order of work

| Step | Outcome | Estimate |
|---|---|---|
| 0 | Spike: Firebase projects on Blaze, Firestore in Sydney, PITR on, a Hosting rewrite to a Sydney Function, an emulator suite running | ½ day |
| 1 | Monorepo; **the test harness and CI pipeline from §9 first**: parallel jobs, per-worker emulator projects, pre-push hook, time budgets enforced, nightly Stryker. Then `core`, test-first (§3) | 4-5 days |
| 2 | Data model, rules, rules tests, indexes, `createOrg`, auth screens, onboarding | ~1 week |
| 3 | Setup screens: properties, tenants, tenancies, charges, settings | ~1 week |
| 4 | Drafting, approval transaction, PDF, approval page, `draftNow` | ~1½ weeks |
| 5 | The tick: request, release, hold, remind; mail adapter; email log | ~1 week |
| 6 | Invoices, tracking, owed, paid ticks, CSV export | ~4 days |
| 7 | Hardening: App Check, budgets, Playwright on throttled mobile, backup restore drill, sending-domain DNS | ~4 days |
| 8 | A parallel month against the Django app, then cut over | 1 billing month |

About seven weeks of build, then one month of running in parallel. Steps 2-7
are each built red, green, refactor (§9.1). The extra day in step 1 pays for the
fast pipeline, and test-first adds no separate testing phase at the end.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| A guarantee is lost in the rebuild | I1-I10 written as tests first; the parallel month |
| The suite gets slow and people stop running it | Per-tier budgets with hard caps, a slow-test alarm, a ratio guard, and slow checks moved to nightly rather than dropped (§9.2-§9.4) |
| Tests pass but don't actually test much | Nightly mutation testing, with 100% required on money and GST; reviewers read tests first (§9.5) |
| Flaky tests erode trust in CI | No silent retries; quarantine within 24 h; nightly flake detector (§9.5) |
| Hosting cannot rewrite to a Sydney Function | Step-0 spike; `us-central1` fallback for one Function |
| The Firebase SDK makes the app heavy on PNG phones | Lazy-load, Firestore Lite where possible, size budgets in CI, a JS-free approval page |
| Email lands in spam | Sending domain with SPF, DKIM and DMARC, plain-text bodies, an email log visible in the UI |
| Rules are too permissive | All money state is server-write-only; rules tests in CI; App Check |
| A scheduled job silently stops | Alerting on tick failure and on "no successful tick in 3 hours" (Cloud Monitoring) |
| Firestore location chosen wrong | It cannot be moved; the spike creates it deliberately in `australia-southeast1` |

---

## 13. Open questions

1. A1-A6 above.
2. **Annual rent escalation** (PLAN.md §5 lists it for v1, but the Django app
   never built it). Is it in v1? It would be a dated rent schedule per tenancy:
   one table, but drafting and tests change.
3. **Invoice templates.** Is one fixed layout enough for v1, or do landlords
   need the "2-3 templates" from PLAN.md §5?
4. **Who signs up?** Is signup invite-only during the parallel month? It should
   be: recommended, behind an allow-list in `createOrg`.
