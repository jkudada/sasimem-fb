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
- **At most 30 lines** per invoice (fits two A4 pages within the 150 KB PDF budget).
- **Sending is the say-so (D7).** There is no approval email for a one-off.
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
- [ ] `issueInvoice` numbers the invoice from the shared counter, freezes the snapshot (customer, address, TIN, PO, notes, template), makes the PDF and emails the customer and copy-to addresses
- [ ] issuing the same draft twice gives one invoice and one number (idempotent), and the draft is gone
- [ ] an org without the `oneOff` feature is refused; so is a non-owner
- [ ] a draft with problems is refused with core's message, and nothing is numbered
- [ ] a one-off issued while a rent run awaits approval: approving the run skips it; the numbers do not collide
- [ ] rebuild, release and PDF making for a month never touch a one-off invoice in that month
- [ ] a one-off invoice is reminded, marked paid, voided and resent like a rent invoice
- [ ] the PDF shows quantity, unit and unit price columns when any line is an item; rent PDFs stay byte-identical (golden)
- [ ] a one-off PDF prints the customer's address, TIN and PO number; within 150 KB with a logo

### Web (T1 web)
- [ ] the menu shows Items and New invoice only when the org has `oneOff`
- [ ] the item list, add, edit and delete
- [ ] the invoice editor: pick a customer, add lines from items or typed, see totals and GST as you type, see problems, Send
- [ ] the Rentals month screens list rent invoices only
- [ ] Settings edits the default payment terms

### End to end (T4)
- [ ] an owner with `oneOff` adds an item, writes an invoice for a customer and sends it; the customer's email has the PDF
