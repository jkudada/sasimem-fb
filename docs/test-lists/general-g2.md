# Test list: G2, one-off invoices, items, payments, credit notes

Written before the code (PLAN-SASIMEM-FB §9.1), from `docs/PLAN-GENERAL-INVOICING.md`
§3.1, §5 and §6. G2 is the first part users see. It is built in slices, each its own PR:

| Slice | What |
|---|---|
| **G2a** | **One-off invoices:** saved items (price list), write a draft, press Send: numbered, frozen, PDF, emailed to the customer and copy-to addresses. Behind the org's `oneOff` feature |
| G2b | **Part payments and receipts:** record a payment against one or more invoices, balance owed, "Part paid", numbered receipts (`RCT-`) emailed |
| G2c | **Credit notes** (`CN-`): reverse all or part of an issued invoice; the balance follows |
| G2d | **Scheduled send** for a one-off invoice (D7's "optional scheduled send") |

## Choices for all of G2 (say if any is wrong)

- **Switched on per org (the feature flag).** `features.oneOff` is server-written. Until G5's
  pricing, an operator script turns it on for an org; nobody sees G2 until then.
- **A one-off invoice never sits in `invoices/` as draft, excluded or approved.** It is written
  in `drafts/{id}` (owner-writable), and only *issuing* creates `invoices/{draftId}` (server-only,
  I9), already numbered and `sent`. This matters because approval, release, PDF making and
  rebuild all load "every invoice in month X" and act on drafts and approved ones: a one-off can
  never be caught up in a rent run. T3 tests prove it.
- **It still records its month** (`period` = the issue month) so the CSV export and the accountant
  see every invoice. The Rentals month screens show rent invoices only.
- **One number sequence (§5.4):** issuing takes the next `INV-` number from the same counter, in a
  transaction, exactly as approval does. A rent run and a one-off issued at the same moment
  cannot share a number (I3).
- **Payment reference = the invoice number** (e.g. `INV-0142`), since there is no tenancy code.
- **Due date:** the draft's own days if set, else the customer's terms, else the org's default
  (`defaultTermsDays`, 14 when not set; editable in Settings).
- **PO required:** a customer flagged "PO required" cannot be invoiced without an order number.
- **No negative invoice.** Discount lines are allowed, but the total must be at least K0.00;
  money back is a credit note (G2c).
- **The PO number and TIN print in the bill-to block**, not beside the invoice number: the
  Compact layout fits only four facts in its row.
- **Copy-to (cc) is new in the mailer** for both Resend and Gmail.
- **Known local flake, not G2:** `trackingPage` "with 20 tenants" times out at 5 s on this shared
  machine, with main's code too (checked 2026-11-19); CI passes it.
- **At most 30 lines** per invoice (fits two A4 pages within the 150 KB PDF budget).
- **Sending is the say-so (D7).** There is no approval email for a one-off.
- **Screens (G2a web):** a new invoice opens with one blank line; an item picked from the price
  list fills it rather than leaving it empty above. **Save draft** keeps an unfinished invoice
  (no customer yet, say) but refuses a quantity or price it cannot read, so a draft never stores
  nonsense; **Send** checks everything, saves, then calls `issueInvoice`. A failed send keeps
  the saved draft, and the next try saves the same one.
- **Customers' accounts details are edited on the tenant form** when `oneOff` is on (G1 left them
  for G2). Rentals-only orgs see the form unchanged.
- **Switching it on:** `node ops/features.ts --project sasimem-dev --org <orgId> --on rentals,repeating,oneOff`.
  The list replaces what is there: once `features` exists core reads only it.
- **Size:** G2a brought the old "all JS" sum to about 156 of 160 KB. That sum counted every lazy
  screen, which no phone downloads at once, so the budget is now split (`apps/web/.size-limit.mjs`):
  the shell (all JS but the screens) ≤ 160 KB, 119 KB after G2a; each screen ≤ 8 KB.
- **Found while building: the rules check a draft's shape and line count, not each line.**
  Checking 30 lines field by field passes the rules engine's limit of 1,000 expressions per
  write. A draft is a work in progress; `issueInvoice` re-runs core's full checks on a
  defensively read copy (`draftOf`) before anything is numbered, so an invoice is never made
  from a bad line. Items, a single document each, are still checked field by field.

## G2a: one-off invoices

### core (T1)
- [x] items: name 1-100, description ≤ 200, unit ≤ 12, a price within ±K10,000,000, a known tax code
- [x] a draft's problems: no customer; no lines; more than 30 lines; a bad line (by index); PO over 40 characters; notes over 500; due days outside 0-90; a negative total
- [x] a PO-required customer with no PO number is a problem; with one, it is fine
- [x] due days: the draft's, else the customer's terms, else the org default, else 14
- [x] the issued invoice: item lines and totals from core, issue date = today (landlord time), due date from the terms, title from today's GST rule, source `oneOff`, period = the issue month
- [x] the payment reference is the invoice number
- [x] a stored draft is read defensively: a malformed line becomes a line with problems (e.g. "Line 2: Say what this line is for."), never a crash
- [x] a draft line copied from an item keeps the item's price and tax code; editing the draft line does not change the item

### Security rules (T2)
- [x] an owner creates, updates and deletes items and drafts; a member only reads; a stranger nothing
- [x] bad items are refused (the core limits, unknown fields, a float price)
- [x] bad drafts are refused (PO, notes, due days, not a list of lines, more than 30 lines, unknown fields)
- [x] **a draft's lines are not checked field by field here** (see choices): one with a bad line is accepted, and refused at issuing (T3)
- [x] no one writes `invoices/` directly, a one-off included (I9, unchanged)
- [x] `features` and `modules` on the org cannot be written by the owner
- [x] `defaultTermsDays` is an owner-editable profile field, 0-90

### Functions (T3)
- [x] `issueInvoice` numbers the invoice from the shared counter, freezes the snapshot (customer, address, TIN, PO, notes, template), makes the PDF and emails the customer and copy-to addresses
- [x] issuing the same draft twice gives one invoice and one number (idempotent), and the draft is gone; two presses at the same moment too (race)
- [x] an org without the `oneOff` feature is refused; so is a non-owner
- [x] a draft with problems is refused with core's message, and nothing is numbered
- [x] a one-off issued while a rent run awaits approval: approving the run skips it; the numbers do not collide
- [x] rebuild, release and PDF making for a month never touch a one-off invoice in that month
- [x] a one-off invoice is marked paid and resent (with its copy-to) like a rent invoice; reminders and void use the same code paths
- [x] the PDF shows an item's quantity, unit and price under its description ("1.5 hour × K80.00"), not new columns; rent PDFs match their golden text unchanged
- [x] a one-off PDF prints the customer's address, TIN and PO number; within 150 KB with a logo

- [x] email: copy-to addresses go as cc through Resend and Gmail; none means no cc field
- [x] email: a one-off is worded "has sent you invoice INV-0001 for your order PO-7731", with no unit or month, and carries its notes; a rent invoice's email is unchanged

### Web (T1 web)
- [x] the menu shows One-off invoices and Price list only when the org has `oneOff` (and then names the months "Rent invoices", and tenants "Tenants and customers")
- [x] the item list, add, edit and delete
- [x] the invoice editor: pick a customer, add lines from items or typed, see totals and GST as you type, see problems, Send
- [x] the Rentals month screens list rent invoices only
- [x] Settings edits the default payment terms
- [x] with `oneOff`, the tenant form asks for a customer's accounts details (copy-to, address, TIN, GST number, terms, PO required); without, it is unchanged

### Ops
- [x] `ops/features.ts` writes an org's whole features map (only that field, on an org that exists); its copy of core's features is proved equal

### End to end (T4)
- [x] an owner with `oneOff` adds an item, writes an invoice for a customer and sends it; the customer's email has the PDF; the month's rent review does not list it

## G2b: part payments and receipts

### Choices (say if any is wrong)

- **Behind `oneOff`, like all of G2.** Rentals-only orgs keep the paid tick exactly as today.
- **A payment is server-written** (`payments/{id}`, I9 as for invoices): customer, received on,
  amount, method (bank transfer, cash, cheque, card, mobile money, other), reference, note,
  allocations `[{ invoiceId, number, amountToea }]`, credit, receipt number, status.
- **Allocation:** the screen proposes oldest due first (core); the owner can change it. The
  server re-checks every allocation against the balances in the same transaction: an invoice of
  this customer, sent, never more than its balance, at most 20 invoices per payment.
- **Overpayment is kept as credit** on the payment and shown against the customer. *Using* a
  credit against a later invoice comes with credit notes (G2c), which also make credit.
- **An invoice records `amountPaidToea`.** Its balance is the total less that; at 0 it is `paid`
  (with `paidAt`), otherwise it stays `sent` and shows **Part paid** (Overdue still wins past the
  due date). An invoice ticked paid before G2b, with no `amountPaidToea`, counts as paid in full.
- **Still owed sums balances**, not totals.
- **Receipts are numbered `RCT-`** from their own counter, in the payment's transaction, and never
  reused: an undone payment keeps its number, marked undone.
- **The receipt is an email**, to the customer and their copy-to, sent when the owner ticks
  "Email a receipt" (on by default; the owner presses Record, so this is their say-so). It names
  each invoice paid and what is still owed on it. **No receipt PDF yet** (later, with statements, G7).
- **A mistaken payment is undone**, with a reason, never edited: its allocations come off the
  invoices (a paid invoice goes back to sent), and nobody is emailed.
- **While an invoice has payments recorded:** the paid tick and "not paid" are refused (record or
  undo a payment instead), and so is void (undo the payments first; G2c's credit notes handle money
  already taken).
- **A reminder for a part-paid invoice asks for the balance**, and says what was paid.
- **Found while building:** the wiring test's list of mailing functions lacked `issueInvoice` (G2a);
  it now has it, with `recordPayment` and `resendReceipt`. A receipt that could not be emailed can
  be sent again (`resendReceipt`), as an invoice can.
- **Recording the same payment twice gives one payment:** the screen makes the payment's ID, and
  the server creates it only once.
- **The CSV export is unchanged;** payments go in the accountant's export (G7, AR-14).
- **`setNextInvoiceNumber` now merges** into the counter, so it cannot wipe the receipt counter.

### core (T1)
- [x] paid so far and balance: from `amountPaidToea`; a paid invoice without it is paid in full; void and unissued owe nothing
- [x] oldest first: by due date then number; stops when the money runs out; the rest is credit
- [x] a payment's problems: no customer; a date not a date or after today; amount 0, negative or over the limit; unknown method; reference over 40, note over 200
- [x] allocations: an invoice not open for this customer; the same invoice twice; 0 or negative; more than its balance; more than the payment; over 20
- [x] applying a payment: part leaves it sent with a balance, the rest makes it paid; undoing reverses either
- [x] the chip: Part paid before the due date, Overdue after, Paid when the balance is 0
- [x] arrears sum balances
- [x] property: any payment allocated oldest first never takes an invoice below 0, and allocations + credit = amount

### Security rules (T2)
- [x] members read payments; nobody writes them

### Functions (T3)
- [x] `recordPayment` allocates, updates each invoice, numbers the receipt (RCT-0001, then 0002), records the event, and emails the receipt to the customer and copy-to
- [x] paying an invoice in full marks it paid; part leaves it sent with its balance; overpayment is stored as credit
- [x] the same payment ID twice gives one payment, one receipt number, one email
- [x] refused: no `oneOff`; not the owner; an invoice of another customer, unsent, paid or void; more than the balance (checked in the transaction, so two payments at once cannot overpay an invoice)
- [x] without "Email a receipt" nothing is sent; a refused email leaves the payment recorded and says so
- [x] `undoPayment` takes the allocations off, reopens a paid invoice, keeps the receipt number, emails nobody; twice is once
- [x] mark paid, not paid and void are refused while an invoice has payments
- [x] a part-paid invoice's reminder asks for the balance
- [x] `setNextInvoiceNumber` keeps the other counters

### Web (T1 web)
- [ ] Still owed: Record a payment per customer (with `oneOff`), balances, Part paid, credit
- [ ] the payment form: customer, amount, date, method, reference; allocation proposed oldest first and editable; credit shown; problems; Email a receipt
- [ ] the payments list: receipt number, customer, amount, undone ones marked; Undo with a reason
- [ ] Home's Payments tile only with `oneOff`

### End to end (T4)
- [ ] an owner records a part payment then the rest for a one-off invoice; the customer gets two receipts; the invoice ends paid
