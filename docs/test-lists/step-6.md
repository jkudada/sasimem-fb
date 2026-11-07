# Step 6 test list: invoices, tracking, owed, paid ticks, CSV export

Written before the code (plan §9.1). Ticked as each goes red → green.

Where step 6 ends (plan §11 leaves the edges open; chosen here):
- **In:** the tracking page (the approval link after sending) with its paid ticks; the
  owed page; the callables `markPaid`, `markUnpaid`, `pauseReminders`, `voidInvoice`,
  `pdfUrl`, `exportCsv` and `resendInvoice`; the console's invoices, month and owed
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
- **T4 journey 3 runs the real scheduled `tick`** through the Pub/Sub emulator (added to
  the T4 suite), after moving the run's send time into the past. No test-only code ships.

## core (T1)
- [ ] invoiceChip: "Paid", "Not paid", "Overdue" after the due date (landlord's day), "Void", "Left out", "Draft", "Approved"
- [ ] arrears: unpaid sent invoices grouped by tenant, the group owing longest first, each with its total and oldest due date; paid and void are not owed
- [ ] owedTotal: the sum of what is owed
- [ ] paidSummary: how many of a month's issued invoices are paid, and what is still unpaid
- [ ] canVoid: approved, sent or paid; voidReasonProblem: a reason is required, at most 200 characters
- [ ] paidNoteProblem: at most 200 characters
- [ ] exportRangeProblem: from ≤ to, at most 24 months
- [ ] invoicesCsv: a header and one row per invoice, amounts as plain decimals, quotes escaped, formulas defused

## Functions (T3)
### Payment ticks and the reminder switch
- [ ] markPaid: a sent invoice becomes paid with paidAt and the note, an events entry, and no email
- [ ] markPaid again keeps the original date; a draft, approved or void invoice is refused
- [ ] markUnpaid: back to sent, paidAt cleared, remindedAt untouched
- [ ] pauseReminders: sets and clears remindersPaused; refused for a stranger
### Void
- [ ] voidInvoice: an approved, sent or paid invoice becomes void with the reason, by whom and when, in events; its number stays issued
- [ ] voidInvoice: a draft is refused (leave it out instead); a void invoice is never released or reminded
### PDFs, email again, CSV
- [ ] pdfUrl: a short-lived URL to the invoice's PDF for an owner; refused for a stranger, and for an invoice without one
- [ ] resendInvoice: emails the tenant again with the PDF, logged; refused for an invoice not yet sent or void
- [ ] exportCsv: the issued invoices in the range, by number, void ones marked; refused for a stranger or a bad range
### Tracking and owed pages (HTTP)
- [ ] release mints a 60-day tracking link; the dispatch notice carries it and the owed link
- [ ] a sent month's link shows each invoice - number, tenant, total, due date, paid or not - and a total still unpaid
- [ ] a paid tick from the page marks it paid (or not), with a valid nonce only, and emails nobody
- [ ] the owed page lists every unpaid invoice across months, grouped by tenant, oldest debt first, with the total
- [ ] the owed page from a dead link offers a fresh link and shows nothing owed
- [ ] a dead link for a sent month emails a fresh tracking link to the org's address
- [ ] the tracking and owed pages carry the same headers, stay under 30 KB, and need no JavaScript

## Web (T1)
- [ ] invoices screen: every month with its status, linking to the month
- [ ] month screen, once sent: each invoice's chip, number and total; Mark paid (with an optional note) and Not paid after all
- [ ] month screen: PDF opens the short-lived link; Pause reminders / Resume reminders; Email again
- [ ] month screen: void asks for a reason and confirms first
- [ ] month screen: the month's email log, with a refused send called out
- [ ] owed screen: grouped by tenant, oldest debt first, with the total
- [ ] CSV export: choose from and to months, and the file downloads; a bad range is a message
- [ ] home: "2 of 3 paid" or "All paid" for a sent month, and the amount owed across months linking to the owed screen

## T4 journeys (Playwright, emulators)
- [ ] journey 3: tick past the send time, the tenant's email arrives with its PDF, then mark it paid
