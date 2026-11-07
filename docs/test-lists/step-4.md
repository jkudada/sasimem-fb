# Step 4 test list: drafting, approval, PDF, the approval page, draftNow

Written before the code (plan §9.1). Ticked as each goes red → green.

Where step 4 ends (plan §11 leaves the edges open; chosen here):
- **In:** drafting a run and its invoices; redrafting (`rebuildRun`); the editing callables
  (`setRent`, `exclude`, `include`); the approval transaction (I3, I4) from the console
  (`approveRun`) and the page; PDFs rendered once after approval (I5); the approval page
  with its expired/rotated-link page and "email me a fresh link" (I10); `draftNow` and
  `reissueApproval`. A `Mailer` interface with a fake (tests) and a console mailer
  (emulator), and the two emails these need: the approval digest and the fresh link.
- **Step 5:** the tick (draft, request, release, hold, remind), the Resend adapter, the
  `emails` log, and the held, dispatch, tenant and reminder emails.
- **Step 6:** the tracking and owed pages, paid ticks, `pdfUrl`, void, CSV.

Choices the plan leaves open (say if any is wrong):
- `approvalTokens` are keyed by the SHA-256 of the token, not the token itself, so a
  leaked database export holds no working links. The token is 32 random bytes, base64url.
- The approval link's origin comes from a `APP_URL` parameter (the Hosting URL).
- Logos are downscaled to ≤ 400 px with `sharp` when a PDF is rendered (the step-3 deferral);
  WebP and GIF logos are converted, since PDFKit embeds only PNG and JPEG.
- `issuedNumbers` are keyed by the integer, and PDFs live at `invoices/{orgId}/{invoiceId}.pdf`,
  so an invoice prefix can never break a document ID or a Storage path.
- A replaced token is marked `replacedAt`, not deleted, so its old link can still offer a fresh
  one (always to the org's address on file, at most one each 10 minutes).
- The Storage emulator ignores `ifGenerationMatch`, so I5 also checks for an existing PDF first,
  and rendering is deterministic.
- The console gets one "this month" review screen (rents, include/exclude, approve) using
  the same callables as the page. The invoices-by-month screen is step 6.

## core (T1)
- [x] invoiceSnapshot: freezes the org's letterhead, bank and GST, and the tenant, unit and address
- [x] redraftPlan: creates drafts for newly active tenancies, rebuilds draft and excluded ones, deletes drafts for tenancies no longer active
- [x] redraftPlan: never touches an approved, sent, paid or void invoice
- [x] readApprovalForm: rents typed as kina per invoice and the included set; a bad amount is a message for that row
- [x] applyApprovalEdits: a changed rent re-totals from the lines (withRent); an unticked invoice is excluded
- [x] digestSubject: "5 invoices ready for October 2026 - K6,400.00"
- [x] approval nonce (functions/links.ts, needs node:crypto): signed with the key, refused when altered, expired after 30 minutes, or for another token

## Security rules (T2)
- [x] a member can read their org's runs and invoices; a stranger cannot
- [x] still nobody but the server writes runs, invoices or issuedNumbers (I9 test covers it)

## Functions (T3, real emulators)
### Drafting
- [x] draftRun: one invoice per active tenancy, ID `{tenancyId}_{period}`, totals from core, status draft (I1)
- [x] draftRun: a second call for the same period creates nothing new (I1, I2)
- [x] draftRun: the run records sendAt, the invoice count and the total
- [x] invariants/I7: no document drafting or approval writes contains a float
### Requesting approval and the link
- [x] draftNow: drafts the period, moves the run to awaitingApproval, stores a hashed token with a 7-day expiry, and emails the digest with the link to the org's address
- [x] draftNow: refused for a non-owner; a period with no active tenancy says so plainly
- [x] draftNow on a period already awaiting approval re-sends nothing and says it is waiting
- [x] reissueApproval: rotates the token (the old one stops working) and emails the org's address only
### Editing a run
- [x] setRent: changes one invoice's rent and re-totals it, only while the run is editable
- [x] exclude / include: only a draft can be excluded and only an excluded one included, while editable
- [x] rebuildRun: rebuilds drafts from current tenancy data, discarding rent edits; refused once approved
### Approval (I3, I4)
- [x] invariants/I3: approving numbers the included invoices from the counter, by tenant name then tenancy ID, with no gap for an excluded one
- [x] invariants/I3: each number has an issuedNumbers document; the counter moves past the last
- [x] approval freezes each invoice's snapshot and sets the run approved with approvedAt, plus an events entry
- [x] invariants/I4: two concurrent approvals produce one set of numbers
- [x] invariants/I4: approving an approved run returns it unchanged
- [x] a cancelled run cannot be approved; a held one can, late
### PDF (I5)
- [x] the PDF golden file: a fixed invoice's extracted text matches, TAX INVOICE with a GST column only when a line is taxable
- [x] a PDF with a logo stays ≤ 150 KB, the logo downscaled to ≤ 400 px
- [x] after approval each approved invoice has a PDF at invoices/{orgId}/{number}.pdf and its pdfPath set
- [x] invariants/I5: re-rendering an invoice whose PDF exists does not overwrite it, and records the path
### The approval page (HTTP)
- [x] GET with a live token: one row per invoice (tenant, unit, reference, rent, include box), a total and one Approve button, with no required script, ≤ 30 KB
- [x] every response carries no-store, no-referrer, noindex and a strict CSP
- [x] POST with the nonce applies rent edits and exclusions, approves, and redirects to the page, which says when it goes out
- [x] POST without a valid nonce, or with a stale one, changes nothing
- [x] a bad amount in the form re-shows the page with the message and approves nothing
- [x] invariants/I10: an expired or rotated token opens only the "request a new link" page
- [x] "email me a fresh link" sends to the org's address on file, never one the visitor supplies
- [x] a held run's page says it will go out within the hour once approved
- [x] an approved run's page shows "Approved - goes out {date, local time}" and no form

## Web (T1)
- [ ] home: this month's status and the one action that matters ("Generate this month's invoices now", "Review 5 invoices", "Approved - goes out ...")
- [ ] review screen: each invoice's tenant, rent and total; rent edits and include/exclude call the callables
- [ ] review screen: approve, and rebuild with its warning that rent edits are discarded
- [ ] the callables' plain messages are shown; offline says a connection is needed

## T4 journeys (Playwright, emulators)
- [ ] journey 1: onboarding to first draft
- [ ] journey 2: approve from the emailed link with JavaScript disabled
- [ ] journey 4: an expired link leads to a fresh-link request

## Budgets
- [ ] approval page ≤ 30 KB and needs 0 KB of JavaScript; PDF ≤ 150 KB; sign-in ≤ 70 KB; shell ≤ 160 KB
