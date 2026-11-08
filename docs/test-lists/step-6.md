# Step 6 test list: invoices, tracking, owed, paid ticks, CSV export

All items done. All four T4 journeys now run.

Written before the code (plan §9.1). Ticked as each goes red → green.

Where step 6 ends (plan §11 leaves the edges open; chosen here):
- **In:** the tracking page (the approval link after sending) with its paid ticks; the
  owed page; the callables `markPaid`, `markUnpaid`, `pauseReminders`, `voidInvoice`,
  `invoicePdf` (in place of `pdfUrl`), `exportCsv` and `resendInvoice`; the console's invoices, month and owed
  screens; home's paid count and amount owed; T4 journey 3.
- **Step 7:** App Check, budgets, throttled-mobile Playwright, the backup restore drill,
  sending-domain DNS.

Choices the plan leaves open (say if any is wrong):
- **A tracking link is minted at release** and carried by the dispatch notice, with the
  owed page's link. It lives 60 days. Approval links still live open the tracking page
  too. "Email me a new link" on a sent month's dead link sends a new tracking link.
- **The owed page opens from any live link of the org**, so it is reachable only from a
  link that was emailed (plan §6.1).
- **Paid ticks on the page are one button per invoice** (a form each, no JavaScript):
  "Mark paid" / "Not paid after all". The console also takes an optional note.
- **Void** applies to an approved, sent or paid invoice, needs a reason, and keeps its
  number (numbers are never reused). A draft is left out instead. A void invoice is
  never sent, reminded or owed.
- **"Email again"** (`resendInvoice`) re-sends a sent or paid invoice with its PDF on the
  landlord's explicit tap - the dispatch notice points there when an address was
  refused. It is logged, with no idempotency key.
- **CSV:** issued invoices (numbered) in a range of at most 24 months, by number;
  amounts as plain decimals (`1200.00`), dates `YYYY-MM-DD`, and a cell starting with
  `= + - @` is prefixed with `'` so a spreadsheet never runs it.
- **The PDF comes back from the callable itself (`invoicePdf`), not as a signed URL.** A PDF
  is 3-150 KB. Nothing reusable leaves the server, deployed Functions need no signing role
  (Service Account Token Creator), and it works under the Storage emulator, which cannot sign.
- **T4 journey 3 runs the real scheduled `tick`**, after moving the run's send time into
  the past. The Functions emulator loads a scheduled function only with the Pub/Sub
  emulator running (now in the T4 suite and `pnpm emulators`), but firebase-tools 15.25's
  Pub/Sub bridge refuses v2 schedules, so the journey posts to the trigger's emulator
  endpoint, the request the bridge would make. No test-only code ships.

## core (T1)
- [x] invoiceChip: "Paid", "Not paid", "Overdue" after the due date (landlord's day), "Void", "Left out", "Draft", "Approved"
- [x] arrears: unpaid sent invoices grouped by tenant, the group owing longest first, each with its total and oldest due date; paid and void are not owed
- [x] owedTotal: the sum of what is owed
- [x] paidSummary: how many of a month's issued invoices are paid, and what is still unpaid
- [x] canVoid: approved, sent or paid; voidReasonProblem: a reason is required, at most 200 characters
- [x] paidNoteProblem: at most 200 characters
- [x] exportRangeProblem: from ≤ to, at most 24 months
- [x] invoicesCsv: a header and one row per invoice, amounts as plain decimals, quotes escaped, formulas defused

## Functions (T3)
### Payment ticks and the reminder switch
- [x] markPaid: a sent invoice becomes paid with paidAt and the note, an events entry, and no email
- [x] markPaid again keeps the original date; a draft, approved or void invoice is refused
- [x] markUnpaid: back to sent, paidAt cleared, remindedAt untouched
- [x] pauseReminders: sets and clears remindersPaused; refused for a stranger
### Void
- [x] voidInvoice: an approved, sent or paid invoice becomes void with the reason, by whom and when, in events; its number stays issued
- [x] voidInvoice: a draft is refused (leave it out instead); a void invoice is never released or reminded
### PDFs, email again, CSV
- [x] invoicePdf: the invoice's own frozen PDF for an owner, named by its number; refused for a stranger, and for an invoice without one
- [x] resendInvoice: emails the tenant again with the PDF, logged; refused for an invoice not yet sent or void
- [x] exportCsv: the issued invoices in the range, by number, void ones marked; refused for a stranger or a bad range
### Tracking and owed pages (HTTP)
- [x] release mints a 60-day tracking link; the dispatch notice carries it and the owed link
- [x] a sent month's link shows each invoice - number, tenant, total, due date, paid or not - and a total still unpaid
- [x] a paid tick from the page marks it paid (or not), with a valid nonce only, and emails nobody
- [x] the owed page lists every unpaid invoice across months, grouped by tenant, oldest debt first, with the total
- [x] the owed page from a dead link offers a fresh link and shows nothing owed
- [x] a dead link for a sent month emails a fresh tracking link to the org's address
- [x] the tracking and owed pages carry the same headers, stay under 30 KB, and need no JavaScript

## Web (T1)
- [x] invoices screen: every month with its status, linking to the month
- [x] month screen, once sent: each invoice's chip, number and total; Mark paid (with an optional note) and Not paid after all
- [x] month screen: PDF downloads the invoice's PDF; Pause reminders / Resume reminders; Email again
- [x] month screen: void asks for a reason and confirms first
- [x] month screen: the month's email log, with a refused send called out
- [x] owed screen: grouped by tenant, oldest debt first, with the total
- [x] CSV export: choose from and to months, and the file downloads; a bad range is a message
- [x] home: "2 of 3 paid" or "All paid" for a sent month, and the amount owed across months linking to the owed screen; an Invoices link

## T4 journeys (Playwright, emulators)
- [x] journey 3: tick past the send time, the tenant's email arrives with its PDF, then mark it paid
