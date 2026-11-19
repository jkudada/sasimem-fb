# General invoicing: modules, landing page, pay-for-what-you-use

Status: **agreed, nothing built.** Written 2026-11-19 at the user's request.
On 2026-11-19 the user said "go with your recommendations", and asked that
**quotes come first when needed and turn into an invoice once the customer
accepts** (§3.3). Those decisions are D1-D11 below. The questions still open
are in §12. Builds on `docs/product.md`, `docs/PLAN-SASIMEM-FB.md`,
`docs/PLAN-TEMPLATES.md` and `docs/PLAN-SUBSCRIBERS.md`.

## 0. Decisions (2026-11-19)

| # | Question | Decision |
|---|---|---|
| D1 | Modules at launch | **Rentals** (have), **Trades & Contracting**, **General**. Others only when asked for |
| D2 | Pricing model | **Building blocks** (§7), with "popular setups" shown as bundles. The §7 prices are the starting figures; they are data and can change |
| D3 | Sign-up | **Requests for an invitation** until G5 (the new pricing) is live, then **open sign-up** with a 60-day trial |
| D4 | Where the app lives | **`/app/` on the same Hosting site**. Whether there is a custom domain is still open (§12 N5) |
| D5 | Several modules per org | **Yes** |
| D6 | Accounts payable | **Only §6.1** (invoices easy for customers' AP teams). No bills module now; revisit for Trades job costing |
| D7 | Sending a one-off invoice | **Pressing Send is the say-so**, with an optional scheduled send. No approval email |
| D8 | Mobile money for customers | **Not now.** Payment details are printed on the invoice only |
| D9 | First Trades release | **Jobs and deposits first**, then progress claims and retention |
| D10 | Prices | The §7 figures |
| D11 | Quotes | **A shared feature for every module**, not Trades-only: write a quote, send it, the customer accepts, and it **converts into an invoice** (or a deposit plus a final invoice). §3.3 |
| D12 | How a quote is accepted | **Online through the link by default; the owner can also record the answer by hand** |
| D13 | Deposits on acceptance | **Off by default.** A per-org setting: "ask for a deposit of __% on quotes over K__" |
| D14 | What happens on acceptance | **The invoice (or deposit invoice) is drafted automatically** and waits for the owner to press Send |
| D15 | Customer changes on the quote page | **Accept, or decline with a comment.** No change requests; the owner sends a revision |
| D16 | Custom domain | **None yet.** G4 is built and tested on `sasimem-dev.web.app`. A domain is needed before the landing page goes public or sign-up opens (§12 N9) |
| D17 | Quote validity | **30 days by default**, changeable per org and per quote |
| D18 | Quote terms | **One terms box per org**, printed on every quote, pre-filled with a default the owner edits |
| D19 | Invitation requests (until D3 opens sign-up) | **Reviewed by the user in the operator console**, with an email to the user for each request |

## 1. The idea in one paragraph

Sasimem becomes a general invoicing product for small PNG businesses. It has a
**shared core** (customers, items, one-off and repeating invoices, approval,
numbering, GST, PDFs, email, payments, reminders, reports) and **industry
modules** that add the words, screens and rules a line of work needs. Today's
app becomes the **Rentals module**, unchanged for the people already using it.
**Trades & Contracting** (electricians, plumbers, builders) is the second module.
A new public landing page asks two questions, *what work do you do?* and *how do
you bill?*, then recommends a set of features and a price. Subscribers pay
for the features they turn on, and nothing else.

## 2. What must not change

These carry over from the earlier plans and apply to every module:

- **Silence never means send.** A repeating batch that nobody approved is
  *held*, never sent. A one-off invoice goes out only when the owner presses
  Send, or at a send time the owner chose.
- **Issued invoices are frozen (I5).** The snapshot and PDF are made once, at
  approval. To fix one you issue a **credit note**, never an edit (§6, AR-3).
- **One number sequence per org, allocated at approval**, with no gaps and no
  reuse. Credit notes and quotes get their own prefixes (§5.4).
- **Integer toea (I7)**, server-write-only invoices, payments and subscriptions (I9),
  and an audit event for every change.
- **Budgets.** The sign-in route stays ≤ 70 KB and PDFs stay ≤ 150 KB. Every module
  screen is a lazy route, so a Rentals-only user never downloads Trades code.
- **Existing Rentals users notice nothing** except new menu items they can
  choose to turn on. Issued invoices, numbers, links and PDFs stay as they are.

## 3. Recommended product shape

### 3.1 Core, used by every module

| Capability | What it is | Today |
|---|---|---|
| Customers | Who you bill: name, billing email, phone, address, TIN/GST no., payment terms, "PO required" flag | Only as *tenants* |
| Items & price list | Saved services, materials and labour rates, each with a unit (each, hour, m, day) and a tax code | No |
| **Quotes** | Price the work first. The customer accepts it (online or by telling you), and it becomes an invoice in one tap (§3.3) | No |
| **One-off invoices** | Write it, preview it, send it. Lines are quantity × unit price | No |
| **Repeating invoices** | A schedule (weekly, fortnightly, monthly, quarterly, yearly) that drafts on a date and goes into the batch approval email | Monthly rent only |
| Approval & sending | Today's digest email, signed link and hold, for anything repeating | Yes |
| Payments | Full and **part** payments, a receipt by email, overpayment kept as credit | Mark paid only |
| Credit notes | Reverse all or part of an issued invoice | Void only |
| Reminders | A schedule of reminders, pausable per customer (§6, AR-7) | One reminder |
| Reports | Money owed by age, customer statement, CSV export for the accountant | Owed list, export |
| Templates, logo, branded email | As built | Yes |

### 3.2 Modules

| Module | For | Adds on top of the core | Launch |
|---|---|---|---|
| **Rentals** | Landlords, property managers | Properties → units → tenancies, rent with extras, residential GST exemption, the monthly rent run. **Today's app, unchanged** | Already live |
| **Trades & Contracting** | Electrical, plumbing, building, mechanics, cleaning, security | Jobs with a site address (an accepted quote can open one), labour + materials lines, **progress claims** with a running total against the quoted sum, **variations** to an accepted quote, **retention** held and released, maintenance contracts (repeating) | **Second (D1)** |
| General | Anyone else (shops, transport, catering) | Nothing extra: core only | With Trades |
| Professional services | Accountants, consultants, lawyers | Time entries billed by the hour, retainers, disbursements | Later, on demand |
| Schools & clubs | Fees per term, memberships | Term schedules, many payers per student/member, family accounts | Later, on demand |

**Recommendation:** build the core and Trades properly, and let *General* cover
every other business from day one. Build further modules only after real
demand (for example five sign-ups asking for one). Each module is a folder of
lazy screens plus one adapter in `core` that turns its records into invoice lines
(§5.2), so adding one later does not touch the others.

**One org can turn on several modules (D5).** An electrician who also lets two
flats should not need two accounts. Customers, numbering and reports are shared.

### 3.3 Quotes: quote first, invoice once accepted (D11)

Quotes are optional. A business that never quotes never sees them. A business
that does can quote, have the customer accept, and invoice with one tap.

```
 Draft quote ──Send──▶ Sent ──customer opens link──▶ Viewed
     ▲                  │  │                             │
     │ Revise           │  │ (valid-until date passes)    ├─Accept (name, optional PO no.)──▶ Accepted
     │ (new revision,   │  └──────────▶ Expired            │                                    │
     │  same number)    │                                 └─Decline (optional reason)──▶ Declined
     └──────────────────┘                                                                     │
                                       Owner may also mark Accepted/Declined by hand          │
                                       (customer phoned or signed paper)                      ▼
                                                                       Convert ──▶ Invoice draft(s)
                                                                                  │
                                         one of:  • full invoice now
                                                  • deposit invoice now (e.g. 30-50%) + final later
                                                  • staged invoices (Trades: progress claims, G6b)
                                                  • a repeating schedule (maintenance or service contracts)
```

**Rules**

- **A quote is not a tax document.** It prints "QUOTATION", with GST shown so
  the customer knows the full price. Numbers are `QUO-0001` from their own
  counter, allocated when first sent (never when drafted).
- **A sent quote is frozen,** like an issued invoice (I5). Changing it makes a
  **revision** (`QUO-0012 rev 2`). The earlier revision is kept, marked
  *superseded*, and its link stops accepting.
- **Online acceptance needs no login.** Same pattern as the landlord approval
  link: a signed, single-use, expiring link to a light server-rendered page
  (no JavaScript needed). The customer sees the quote and its PDF. To accept,
  they type their name, optionally add their **PO number**, and tick "I accept
  these terms". The record of acceptance (who, when, revision, the totals they saw)
  is kept with the quote and in the audit trail. Declining takes an optional reason.
- **The owner is told at once** by email (and on Home) when a quote is
  accepted or declined.
- **Valid until:** default 30 days, set per org and changeable per quote.
  An expired quote can be re-sent with a new date (a new revision).
- **Optional follow-up:** one friendly reminder to the customer N days after
  sending if nobody responded (default 7, off by default). The owner can turn it on.
- **Converting to an invoice (D14):** on acceptance the lines, customer, PO
  number and terms are copied **automatically** into a **draft** invoice (a
  deposit invoice if D13's setting applies, or if the owner picks "deposit" at
  conversion). The owner reviews and presses Send (D7), so
  nothing is invoiced without their say-so. Converting is idempotent: one quote
  revision gives one set of invoices, so a double tap cannot bill twice.
- **Quoted vs invoiced** is tracked on the quote: when everything accepted has
  been invoiced it shows *Invoiced*. Invoicing more than was quoted is allowed
  but flagged ("K1,200 more than the accepted quote"). In Trades that extra
  should be a **variation** the customer accepts the same way as a quote (G6b).
- **Deposits:** at conversion the owner can choose "deposit now". The deposit
  invoice says "Deposit for QUO-0012" and the final invoice deducts it as a line,
  so GST is counted once. Accounts treat it as a normal invoice: no separate
  liability bookkeeping (we are not an accounting package).
- **Quotes do not count against invoice limits** (§7). Only invoices do.

## 4. Landing page and sign-up

### 4.1 Pages

| Path | Content |
|---|---|
| `/` | Hero ("Invoices that go out on time, with your say-so"), the three promises (set and forget; nothing sent without you; works on your phone), **"What work do you do?"** tiles, short proof (a sample invoice), pricing teaser, sign-in link |
| `/rentals`, `/trades`, `/business` | One page per module: what it does, a sample PDF, screenshots, price |
| `/pricing` | The calculator (§7) |
| `/start` | The guided questions (§4.2) leading to sign-up |
| `/app/…` | The signed-in app (moved here, §4.3) |

**Built as static HTML with no framework (rec.),** pre-rendered at build time
with a few lines of script for the calculator. It loads fast on a PNG phone,
search engines can read it, and the app bundle stays separate. The existing
look (styles.css, the Mark, no web fonts) carries over.

### 4.2 The guided questions (`/start`)

```
 1  What work do you do?        Rentals · Trades & contracting · Professional
                                services · Shop / other · (more coming)
 2  How do you bill?            One-off jobs · The same amount on a schedule ·
                                Both
 3  How many?                   Customers billed regularly: 1-2 · up to 10 · up to 30 · more
                                One-off invoices a month:  up to 5 · up to 50 · more
 4  Are you registered for GST? Yes / No / Not sure (explains the K250,000 threshold)
 5  Do you give customers a price (a quote) before you do the work?
        → turns on Quotes (any line of work)
    (Trades only) Do you take deposits?  Do jobs run longer than a month?
        → turns on Deposits, Progress claims
            │
            ▼
 Your setup: Trades module, one-off invoicing (up to 50/month), quotes,
 progress claims. K__ a month, or K__ a year (2 months free).
 "Why this?" explains each choice.  [Start 60-day free trial]
```

The answers are kept with the sign-up and used to (a) switch on the
recommended features, (b) pick the starting template and wording, and (c) fill
the onboarding steps. Every choice can be changed later in *Plan & billing*.

### 4.3 What it changes in the app

- The app moves from `/` to `/app/` (rec.). Old links (`/settings/...`,
  `/invoices/...`) redirect. `/a/**` and `/x/**` (approval and export links in
  emails already sent) stay exactly where they are.
- Home shows tiles for the modules that are switched on (Rentals: Properties,
  Tenants, Months; Trades: Quotes, Jobs, Invoices), plus the shared ones
  (Customers, Owed, Reports, Settings).
- **Words follow the module.** A Rentals user still sees *tenant* and *rent*. A
  Trades user sees *customer* and *job*. Underneath they are the same customer record.
- Sign-up is invite-only today (`SIGNUP_MODE=invite`). §12 Q3 asks whether the
  landing page opens it or collects requests for invitations.

## 5. How the code changes (the engineering plan)

### 5.1 Approach: grow the core, wrap Rentals (rec.)

Do **not** rename `tenancies` and rewrite the rent run. That would put every
issued invoice and the most trusted part of the product at risk for no gain to
users. Instead:

1. Generalise the **invoice** and the **engine** (drafting, numbering, approval,
   PDF, send, remind) so they accept lines from any source.
2. Make **Rentals an adapter**: tenancies keep their documents and screens and
   produce draft invoices through the generalised engine, exactly as now.
3. Add the **core** records (customers, items, schedules, one-off drafts) next to them.
4. Add **Trades** as a second adapter (quotes, jobs, claims).

### 5.2 Data model additions

```
orgs/{orgId}
  modules            ["rentals", "trades", "general"]        server-write (follows the plan)
  features           { oneOff, repeating, quotes, progressClaims, ... }   server-write
  wording            "rentals" | "trades" | "general"        owner (which words the app uses)
  defaultTermsDays   14
  customers/{id}     name, email, ccEmails[], phone, address, tin, gstNumber,
                     termsDays?, poRequired, remindersPaused, creditToea (server), notes
                     # tenants/{id} are copied here with the SAME id (migration M1);
                     # tenancies keep tenantId, which is now a customer id
  items/{id}         name, description, unit, priceToea, taxCode, active
  schedules/{id}     customerId, frequency, interval, nextIssueOn, endOn?,
                     lines[], dueDays, poNumber?, templateId?      # repeating, non-rental
  drafts/{id}        customerId, lines[], issueOn?, dueOn, poNumber,
                     notes                                       # a one-off being written
  quotes/{id}        customerId, siteAddress?, lines[], totals, terms, validUntil,
                     number (QUO-, set at first send), revision, supersededBy?,
                     status draft|sent|viewed|accepted|declined|expired|superseded|invoiced,
                     snapshot (frozen at send), pdfPath,
                     acceptance?: { by: "customer"|"owner", name, poNumber, at, revision, totalToea },
                     declineReason?, invoicedToea (server), invoiceIds[] (server)
                     # owners write drafts; everything from "sent" on is server-written
  quoteTokens/{token}  (top level) { orgId, quoteId, revision, expiresAt }   server only
  jobs/{id}          (Trades) customerId, quoteId?, siteAddress, contractToea,
                     retentionPercent, claimedToea (server), retainedToea (server)
  invoices/{id}      + source: { kind: "rent", tenancyId, period }
                             | { kind: "schedule", scheduleId, issueOn }
                             | { kind: "oneOff", draftId }
                             | { kind: "quote", quoteId, revision, part: "full"|"deposit"|"final"|"stage" }
                             | { kind: "claim", jobId, claimNo } | { kind: "deposit", jobId }
                     + customerId, poNumber, amountPaidToea, balanceToea
                     + lines[] gain quantity, unit, unitPriceToea, taxCode
                     # Rent invoices keep their id {tenancyId}_{period}; the others
                     # use {scheduleId}_{issueOn} or the draft id (idempotency keys)
  creditNotes/{id}   invoiceId, customerId, number (CN-), lines[], reason, totals  # server only
  payments/{id}      customerId, receivedOn, amountToea, method, reference,
                     allocations: [{ invoiceId, amountToea }], receiptNumber      # server only
```

Rentals collections (`properties`, `tenancies`, `runs`) are unchanged.

### 5.3 Rules for lines and GST

- A line is `quantity × unitPriceToea`, rounded to the toea **per line**, with
  the tax worked out per line and summed (today's gst.ts rounding, generalised).
- **Tax codes:** `standard` (10%), `exempt` (e.g. residential rent), `zero`
  (exports). Rentals keeps "inherit from the property's use". Trades and
  General default to `standard` when the org is GST-registered.
- "TAX INVOICE" vs "INVOICE" keeps today's rule (registered and supply > K50).
  Credit notes print "TAX CREDIT NOTE" (or "ADJUSTMENT NOTE") when the original was a tax invoice.
- Labour and materials are separate lines, so customers can check them and the
  owner can see job costs later.

### 5.4 Numbering

One sequence for invoices across all modules (rec.), so the tax record has no
gaps: `INV-0142` is next whatever produced it. Credit notes `CN-`, quotes
`QUO-` and receipts `RCT-` get their own counters. Only invoices and credit
notes are tax documents. The existing `private/counter` becomes `private/counters`
with one field per document type (migration M2).

### 5.5 Engine changes

| Area | Change |
|---|---|
| Tick step 1 (draft) | Also draft due **schedules** (any frequency). Idempotent on `{scheduleId}_{issueOn}` |
| Runs | A run collects everything due on one send date. Monthly rent runs keep their `YYYY-MM` keys; schedule runs are keyed by date. **The biggest engine risk:** a separate design note before G3 |
| One-off send | A callable `issueInvoice(draftId, sendAt?)` that allocates the number, freezes the snapshot, makes the PDF and sends it (or queues it for `sendAt`). Same transaction shape as approval |
| Quotes | `sendQuote(quoteId)` (number, snapshot, PDF, token, email); a `quotePage` HTTP function at `/q/**` (view, accept, decline; same design and 0 KB JS as `approvalPage`); `markQuote` for owner-recorded answers; `convertQuote(quoteId, plan)` makes invoice drafts with ids `{quoteId}_r{rev}_{part}` so it is idempotent; tick step for expiry and the optional follow-up |
| Payments | `recordPayment` allocates oldest first by default (editable), updates balances, issues a receipt, and stops reminders |
| Reminders | A ladder of steps (§6, AR-7) instead of one reminder |
| Subscriptions | Limits per feature, not just tenancy count (§7) |

### 5.6 Migrations (each idempotent, run with an ops script, dev first)

- **M1** `tenants` → `customers`, same ids; tenants become a read alias until
  the Rentals screens move over.
- **M2** `private/counter` → `private/counters.invoice`.
- **M3** Existing orgs get `modules: ["rentals"]`, `wording: "rentals"`,
  and features matching what they have now.
- **M4** Existing subscriptions map onto the new plans at the **same price**
  (Free 2 / Standard 10 / Plus 30 tenancies = Repeating invoicing at the same tiers).
- Old invoices without `source` are read as `{ kind: "rent" }`.

## 6. Accounts receivable practice built in

| # | Practice | How the product does it |
|---|---|---|
| AR-0 | **Agree the price before the work** | Quotes with written acceptance (§3.3). An accepted quote with the customer's name and PO number is the strongest answer to a later "we never agreed to that" |
| AR-1 | **Invoice promptly** | One-off: an "Invoice this" button on an accepted quote or finished job, and a Home nudge for accepted quotes not yet invoiced after 7 days. Repeating: drafted ahead, sent on the day |
| AR-2 | **Clear terms on every invoice** | A real due date (not just "30 days"), the bank details, and a payment reference to put on the transfer. Terms default per org, can be changed per customer |
| AR-3 | **Never edit an issued invoice** | Corrections go through a credit note, then a new invoice. Void only before sending |
| AR-4 | **Unique numbers, no gaps** | §5.4 |
| AR-5 | **Match money to invoices** | The payment reference (already `referenceCode`), part payments, allocation, overpayment kept as credit |
| AR-6 | **Get money up front on bigger jobs** | Trades: deposit invoices (suggested at 30-50% above a threshold the owner sets), progress claims for jobs over a month, retention tracked and released at the end |
| AR-7 | **Chase consistently** | Default reminders: 3 days before due (optional, friendly), on the due day, +7, +14, +30 ("final notice"). Each step can be turned off. Paused per customer or invoice. Stops on payment. Today's "silence never means send" covers new invoices, not reminders: reminders stay automatic or off, as now |
| AR-8 | **Statements** | A monthly statement for customers with more than one invoice open (common for commercial tenants and trade customers) |
| AR-9 | **Watch the age of debt** | Money owed by age (not yet due, 1-30, 31-60, 61-90, 90+ days), per customer and in total, on the home screen |
| AR-10 | **Receipts** | An emailed receipt with its own number on every payment. Expected in PNG |
| AR-11 | **Credit control (later)** | A credit limit per customer and a "deposit required" flag after a late payer |
| AR-12 | **Write-offs** | Write off a bad debt with a reason, kept for the accountant (as a credit note of type "bad debt") |
| AR-13 | **Late fees** | Possible, **off by default** (rec.), and only if the terms printed on the invoice say so |
| AR-14 | **Accountant export** | CSV of invoices, credit notes, payments and the aged report for any date range |

### 6.1 Accounts payable: making *your customer's* job easy

Most of our subscribers' customers are businesses or government bodies with an
accounts payable process. Invoices get paid faster when they pass that process
the first time. So every invoice can carry:

- **the customer's PO or order number** (required when the customer is flagged
  "PO required", for government and corporate customers);
- the supplier's **TIN and GST number**, legal name and address;
- line descriptions specific enough to check against a delivery or job sheet;
- the **remittance details** (bank, account, payment reference, an email for
  remittance advice).

**A bills module (tracking what you owe suppliers) is not recommended for now.**
It is a different product. The one case worth revisiting is Trades: recording
supplier bills against a job to see whether it made money. §12 Q6 asks.

## 7. Pricing: pay for what you use

Payment stays **by bank transfer, recorded by the operator** (PLAN-SUBSCRIBERS
D1). That makes small monthly usage charges awkward, so the price should be
**known in advance**: a fixed amount for the features chosen, billed annually
(the default) or quarterly.

**Recommended model: building blocks.** The price is the sum of what is turned on.

| Block | Free | Standard | Plus |
|---|---|---|---|
| **One-off invoices** (per month) | 5 | 50 / K30 a month | unlimited* / K80 |
| **Repeating customers** (tenancies or schedules) | 2 | 10 / K40 | 30 / K100 |
| **Rentals tools** | included with Repeating | included | included |
| **Quotes** | included with One-off invoices, every tier (quotes are not counted) | included | included |
| **Trades tools** (jobs, deposits, claims, variations, retention) | - | +K20 a month | +K20 |
| More users (with the admin/roles work) | 1 | +K10 a month per user | |

\* fair-use cap, set in the plan data.

- Annual = 10 × monthly (two months free), as now. Prices are data in `plans/`.
- **Existing Rentals subscribers pay exactly what they pay now:** their current
  plan *is* the Repeating block at the same tier (M4).
- The landing calculator and *Plan & billing* show the same sum.
- 60-day trial of the recommended setup, as now.
- Going over a limit never stops a run that is already drafted (PLAN-SUBSCRIBERS §2).

Alternatives considered:
- **Per invoice** (e.g. K1 each): fair, but needs monthly billing and
  reconciliation by bank transfer. Rejected for now.
- **One bundle per industry** (Rentals plan, Trades plan): simpler to read,
  but someone who only sends three one-off invoices a month pays for features
  they do not use. Could still be shown as "popular setups" on the landing page.

## 8. Order of work

Each phase ships on its own, behind a feature flag, with the TDD tiers as today
(test lists in `docs/test-lists/general-*.md`).

| Phase | What | Visible to users |
|---|---|---|
| **G0** | Answer §12, settle names and prices | - |
| **G1** | Core generalisation: customers (M1), lines with quantity × price and tax codes, `source` on invoices, counters (M2), modules/features on the org (M3). Rentals goes through the new code paths with **byte-identical PDFs** (golden files) | Nothing |
| **G2** | One-off invoices + items + part payments + receipts + credit notes | Rentals users can send a one-off invoice (e.g. a repair charge) |
| **G2q** | **Quotes:** write, send, customer accept/decline page at `/q/**`, revisions, expiry, convert to a full or deposit + final invoice (§3.3) | Yes, for every module |
| **G3** | Repeating schedules at any frequency, in the batch approval (and "convert quote to schedule") | Yes |
| **G4** | Landing page, `/start`, `/pricing`, app moved to `/app/`, module-aware Home, "request an invitation" (D3) | Yes, the new front door |
| **G5** | Subscriptions by block (M4), Plan & billing reworked, operator console updated; sign-up opens (D3) | Yes |
| **G6a** | Trades module: jobs from accepted quotes, deposits, labour/materials, site address on PDFs (D9) | Yes |
| **G6b** | Trades: progress claims, variations accepted like quotes, retention | Yes |
| **G7** | AR extras: reminder ladder, statements, aged report, CSV for the accountant | Yes |
| Later | Professional services, Schools & clubs, bills, credit limits, online/mobile money payments | On demand |

G4 can run alongside G2-G3 (it is mostly static pages). If the landing page
is wanted sooner, G4 can ship first with Trades marked "coming soon".
G2q needs G2 (it converts into G2's one-off invoices) but not G3.

## 9. Interaction with work in flight

- **Admin dashboard plan** (`.worktrees/admin-dashboard`): its counts-only stats
  should count per module and per block. Roles and "more users" pricing depend on it.
- **Subscribers:** M4 changes `plans/` and the limit check; the operator console
  needs a new plan editor.
- **Templates:** each module adds a few printed fields (PO number, site address,
  claim no. / contract sum / retention) to every layout; the test that every
  layout carries the tax-invoice fields is extended.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Breaking the rent run while generalising | G1 changes no behaviour; golden PDFs and the T3/T4 rent journeys must pass unchanged before merge |
| Runs keyed by month do not fit weekly or fortnightly schedules | Separate design note before G3; rent runs keep their keys |
| Scope creep into an accounting package | No ledger, no bank feeds, no bills (unless Q6 says yes); CSV export for the accountant |
| The landing page promises modules that are not built | Unbuilt modules show "Tell me when it's ready" and collect an email |
| Bundle size as modules grow | Lazy routes per module, CI size limits unchanged |
| A quote link is forwarded and someone else accepts | The page records the typed name and time, and the owner is told; the owner can reverse an acceptance before converting. Same exposure as the approval link today |
| A customer accepts an old revision | Superseded revisions stop accepting; only the latest revision's token works |

## 11. Assumptions (correct any)

1. PNG only, PGK only, for now (no multi-currency).
2. Still no online card payment; bank transfer, recorded by hand.
3. The brand stays **Sasimem**; modules are "Sasimem Rentals", "Sasimem Trades".
4. One business identity per org (PLAN-TEMPLATES D2) still holds.
5. GST rules stay PNG's: 10%, residential rent exempt, tax invoice above K50.

## 12. Questions still open

Q1-Q10 were answered on 2026-11-19 (D1-D10), and N1-N8 the same day (D12-D19).
Still open, none blocking G1:

| # | Question | Recommendation | Needed by |
|---|---|---|---|
| N9 | Which **custom domain** (e.g. `sasimem.com.pg` or `.com`)? | Register one, then verify it for email as well (`docs/runbooks/sending-domain.md`) | Before G4 goes public / sign-up opens |
| N10 | The **operator console** is not set up on dev yet (Identity Platform + TOTP). D19 depends on it | Set it up before G4 ships the request form | G4 |
| N11 | **Default quote terms** wording | Draft one with a PNG accountant or lawyer; Claude can write a first version | G2q |
