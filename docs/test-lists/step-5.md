# Step 5 test list: the tick, the mail adapter, the email log

All items done. Every server email goes through the log; the tick is driven in T3 with an
injected clock (the Functions emulator skips scheduled functions).

Written before the code (plan §9.1). Ticked as each goes red → green.

Where step 5 ends (plan §11 leaves the edges open; chosen here):
- **In:** the hourly `tick` (draft, request, release, hold, remind; plan §6.4), the Resend
  adapter, the `emails` log for every message the server sends, and the held, dispatch,
  tenant-invoice and tenant-reminder emails.
- **Step 6:** T4 journey 3 (tick past send time, tenant emails and PDFs, then mark paid) -
  it ends in a paid tick, which is step 6 - and an email log screen alongside the invoices.

Choices the plan leaves open (say if any is wrong):
- **A draft run already past its send time goes straight to held** when approval is
  requested (tick or `draftNow`), and the landlord gets one email - the digest, saying
  approved invoices go out within the hour - instead of a digest and a held notice in
  the same hour.
- **Holding keeps the digest's link working.** The database keeps only token hashes, so
  the held notice cannot carry "the same link". Holding extends the live token's expiry
  by 7 days and adds a second live token for the held email; `reissueApproval` retires
  both.
- **A tenancy becomes `invoiced` when one of its invoices is approved** (it then has an
  issued number, so the rules stop it being deleted). Step 4 never set the flag.
- **Tenant emails carry the PDF; so does the reminder.** It is 3-10 KB.
- **A failed send is logged as `failed`, the others still go, and the tick then throws,**
  so the execution fails visibly and Cloud Scheduler retries. Every step is safe to rerun.
- **Resend gets an `Idempotency-Key`** (`{orgId}/{kind}/{invoiceId or period}`), so a
  retried request within 24 hours cannot deliver twice.
- **The log keeps no bodies** - links are credentials - only kind, to, subject, run
  period, invoice ID, provider message ID, time and status.
- The sender is `MAIL_FROM` (a parameter, e.g. `invoices@mail.sasimem.example`) with the
  landlord's name as display name; Reply-To is the landlord's email.

## core (T1)
- [x] approvalTarget: a draft run asked for approval before its send time waits for approval; at or after it, it is held
- [x] tenantInvoiceSubject / reminderSubject: "Invoice INV-0142 from Wari Holdings - K1,200.00 due 8 October 2026", "Reminder: invoice INV-0142 ..."
- [x] dispatchSubject and heldSubject: "Sent - your October 2026 invoices are with your 5 tenants", "Held: your October 2026 invoices were not sent"

## Mail (T3)
- [x] ResendMailer: posts from, to, subject, text, reply_to and base64 attachments with the key and an Idempotency-Key, and returns Resend's ID
- [x] ResendMailer: a display name cannot break the From header
- [x] ResendMailer: a refusal from Resend is an error naming its status and message
- [x] sendLogged: logs kind, to, subject, run period, invoice ID, provider ID, time and status "sent" - and no body
- [x] sendLogged: only messages sent once per run or invoice carry an idempotency key (not a fresh link)
- [x] sendLogged: a failed send is logged as "failed" with the reason, then rethrown
- [x] the digest and fresh-link emails are logged too

## The tick (T3, real emulators, `now` injected)
### Draft
- [x] drafts a period once its lead time begins, for each org; not before
- [x] a second tick drafts nothing new (I1, I2)
- [x] after the send time, drafts (and so holds) only for an org with an earlier run - an outage, not onboarding
### Request
- [x] a draft run due for approval moves to awaitingApproval and the digest goes to the org, once
- [x] a draft run past its send time goes straight to held, with one email
- [x] two overlapping ticks send one digest
### Release (I6)
- [x] at the send time an approved run becomes sent, with its invoices sent and sentAt set
- [x] each tenant gets their invoice with its PDF attached and Reply-To the landlord, logged with the invoice ID
- [x] the landlord gets the dispatch notice; an empty batch sends nothing
- [x] an approved run before its send time, or a run that was never approved, sends nothing
- [x] two overlapping ticks send one email per tenant
- [x] invariants/I5+I6: after a crash between approval and rendering, the tick renders the PDF and sends it
- [x] invariants/I6: an invoice without a PDF is never sent
### Hold
- [x] a run still waiting at its send time is held, its link lives 7 more days, and the held notice carries a working link
- [x] the digest's link still works after the hold; reissueApproval retires both
- [x] held, then a late approval, then sent at the next tick
### Remind (I8)
- [x] an unpaid sent invoice is reminded once on due date + reminder days, with its PDF, and remindedAt is set
- [x] two overlapping ticks send one reminder; a later tick sends none (I8)
- [x] paused, paid, or an org with reminders off: no reminder
### The tick as a whole
- [x] returns the tally {drafted, requested, sent, held, reminded}
- [x] one org's failure does not stop the others, and the tick then throws
- [x] invariants/I7: nothing the tick writes contains a float
### Invariant files
- [x] invariants/I6: a missing PDF stops the release; a run never approved is never released; two releases release once
- [x] invariants/I8: two concurrent reminder claims, one wins; a later claim wins nothing
### Approval
- [x] approving marks each numbered invoice's tenancy invoiced; an excluded one stays deletable

## Rules (T2)
- [x] a member can read their org's email log; a stranger cannot (writes stay server-only, I9)

## Wiring (T3)
- [x] tick runs every 60 minutes with 3 retries; tick, draftNow, reissueApproval and approvalPage bind RESEND_API_KEY
