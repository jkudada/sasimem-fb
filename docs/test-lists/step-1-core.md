# core test list (step 1)

All items done. Items that passed first time were proved by breaking the code
once (plan §9.1); those commits say so. Two list items were merged into others:
"groups millions" is asserted through amountProblem's message, and "zero days"
lives in the reminder-threshold test.

Written before the code (plan §9.1). Ticked as each goes red → green.
Edge cases come from the plan §3 and, where it is silent, the Django reference
(`money.py`, `gst.py`, `periods.py`, `drafting.py`, `models.py` and their tests).

## money.ts (§3.1)
- [x] toea() accepts an integer
- [x] toea() throws on a non-integer
- [x] toea() throws outside ±MAX_SAFE_INTEGER
- [x] parseKina reads plain kina ("1200" → 120000)
- [x] parseKina strips K, commas and whitespace ("K1,200.50" → 120050)
- [x] parseKina reads one decimal place ("237.5" → 23750)
- [x] parseKina rounds half a toea up, not to even ("0.005" → 1, "0.015" → 2)
- [x] parseKina does not drift where float arithmetic would ("1.005" → 101)
- [x] parseKina reads negatives as credits ("-50" → -5000, "-K50" → -5000)
- [x] parseKina rounds a negative half toea away from zero ("-0.005" → -1)
- [x] parseKina rejects an empty string
- [x] parseKina rejects rubbish ("abc", "1.2.3", "1-2")
- [x] formatKina renders "K1,200.50"
- [x] formatKina renders zero as "K0.00" and small amounts with leading zero ("K0.05")
- [x] formatKina renders negatives as "-K50.00"
- [x] formatKina groups millions ("K10,000,000.00")
- [x] amountProblem: no message up to K10,000,000.00
- [x] amountProblem: a message above K10,000,000.00 (validation, not an error)
- [x] property: formatKina ∘ parseKina round-trips every amount in range
- [x] property: parseKina never returns a non-integer

## gst.ts (§3.2)
- [x] gstOn is 10% exactly on round amounts (240000 → 24000)
- [x] gstOn rounds half a toea up (5 → 1, 4 → 0, 15 → 2)
- [x] gstOn mirrors negatives, half away from zero (-5 → -1, -4 → 0)
- [x] isTaxable: unregistered org never charges GST, even with an explicit taxable line
- [x] isTaxable: treatment taxable is taxable
- [x] isTaxable: treatment exempt is exempt, even on commercial space
- [x] isTaxable: inherit is taxable for commercial use
- [x] isTaxable: inherit is exempt for residential use
- [x] isTaxable: an unknown treatment throws, not a silent exemption
- [x] documentTitle: "TAX INVOICE" when registered and any line taxable
- [x] documentTitle: "INVOICE" when registered but no line taxable
- [x] documentTitle: "INVOICE" when unregistered
- [x] orgProblems: a registered org without a GST number is a validation error
- [x] orgProblems: a registered org with a GST number is fine; whitespace-only counts as missing
- [x] property: gstOn(-x) === -gstOn(x)
- [x] property: gstOn(x) is within half a toea of x/10

## period.ts (§3.3)
- [x] parsePeriod accepts "2026-10" (trimmed)
- [x] parsePeriod rejects "2026-13", "2026-00", "october", "2026-1", ""
- [x] nextPeriod / previousPeriod roll over the year
- [x] firstDay / lastDay of a period, incl. leap February
- [x] day() clamps the 31st to the 30th / 28th / 29th
- [x] periodLabel is "October 2026"
- [x] shortCode is "OCT26"
- [x] addDays crosses month and year ends
- [x] localDate gives the landlord's calendar day in their timezone, not UTC's
- [x] zonedInstant converts a local date and hour in Port Moresby to UTC
- [x] property: next(previous(p)) === p

## billing.ts - drafting (§3.4)
- [x] isActiveIn: a tenancy starting after the month is not active
- [x] isActiveIn: a tenancy that ended before the month is not active
- [x] isActiveIn: a tenancy ending mid-month is still active; an open-ended one is active
- [x] chargeApplies: an inactive charge never applies
- [x] chargeApplies: an `every` charge applies every month
- [x] chargeApplies: a `one` charge applies only in its named month
- [x] paymentReference is "{CODE}-{SHORT}" upper-cased (wari → WARI-OCT26)
- [x] draftInvoice: rent-only residential invoice (line, detail, no GST, totals, title)
- [x] draftInvoice: issue date clamps the billing day; due date = issue + dueDays
- [x] draftInvoice: commercial rent for a registered org carries GST and a tax invoice
- [x] draftInvoice: a recurring charge follows the rent with the period label as detail
- [x] draftInvoice: a one-month charge has an empty detail
- [x] draftInvoice: charges keep the order they were added in
- [x] draftInvoice: a credit reduces the total
- [x] draftInvoice: an extra inherits the commercial treatment; an exempt override is honoured
- [x] draftInvoice: an unregistered landlord letting commercial space charges no GST
- [x] withRent: changes the rent line and recomputes GST and totals from the lines
- [x] withRent: a negative rent is refused
- [x] chargeProblems: a `one` charge needs its month; an `every` charge must not name one
- [x] property: total === subtotal + gst === Σ lines, for any lines

## billing.ts - scheduling (§3.4)
- [x] sendAt: the earliest billing day among active tenancies, at sendHour local, in UTC
- [x] sendAt: day 1 when no tenancy is active
- [x] periodsToDraft: nothing long before the lead time
- [x] periodsToDraft: the period is due inside the lead time
- [x] periodsToDraft: a period that already has a run is skipped
- [x] periodsToDraft: a period with no active tenancy is skipped
- [x] periodsToDraft: considers next month as well as this one (in the org's timezone)
- [x] periodsToDraft: a new landlord is not billed for a month already gone
- [x] periodsToDraft: an established landlord catches up after an outage (earlier run exists)
- [x] periodsToDraft: next month's run does not make this month look like history

## billing.ts - state machine (§3.5, §6.4)
- [x] isEditable for draft, awaitingApproval, held only
- [x] approvalRequestDue: a draft run once now >= sendAt - leadDays (24 h periods)
- [x] releaseDue: an approved run once now >= sendAt; never an unapproved one
- [x] holdDue: an awaitingApproval run once now >= sendAt; never an approved one
- [x] approvalOutcome: approving an approved or sent run is a no-op (I4)
- [x] approvalOutcome: approving a held run is allowed (late approval)
- [x] approvalOutcome: approving a cancelled run is refused
- [x] canExclude / canInclude only while the run is editable
- [x] canMarkPaid only a sent invoice; marking paid twice keeps the first date
- [x] numbering: invoice numbers are prefix + zero-pad(4)
- [x] numbering: included invoices are numbered by tenant name, then tenancy id
- [x] numbering: excluded invoices get no number

## billing.ts - reminders (§3.6)
- [x] reminderDue: not before dueDate + reminderAfterDays; on that day it is due
- [x] reminderDue: zero days means due on the due date itself (reference: `day >= due + 0`)
- [x] reminderDue: a paid invoice is left alone
- [x] reminderDue: an invoice not `sent` is left alone (draft, approved, void)
- [x] reminderDue: a paused invoice is left alone
- [x] reminderDue: an already-reminded invoice is left alone (I8, at most once)
- [x] reminderDue: reminders off for the org means none
- [x] reminderDue: an invoice with no sentAt is never chased
