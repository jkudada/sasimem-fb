# core test list (step 1)

Written before the code (plan §9.1). Ticked as each goes red → green.
Edge cases come from the plan §3 and, where it is silent, the Django reference
(`money.py`, `gst.py`, `periods.py`, `drafting.py`, `models.py` and their tests).

## money.ts (§3.1)
- [ ] toea() accepts an integer
- [ ] toea() throws on a non-integer
- [ ] toea() throws outside ±MAX_SAFE_INTEGER
- [ ] parseKina reads plain kina ("1200" → 120000)
- [ ] parseKina strips K, commas and whitespace ("K1,200.50" → 120050)
- [ ] parseKina reads one decimal place ("237.5" → 23750)
- [ ] parseKina rounds half a toea up, not to even ("0.005" → 1, "0.015" → 2)
- [ ] parseKina does not drift where float arithmetic would ("1.005" → 101)
- [ ] parseKina reads negatives as credits ("-50" → -5000, "-K50" → -5000)
- [ ] parseKina rounds a negative half toea away from zero ("-0.005" → -1)
- [ ] parseKina rejects an empty string
- [ ] parseKina rejects rubbish ("abc", "1.2.3", "1-2")
- [ ] formatKina renders "K1,200.50"
- [ ] formatKina renders zero as "K0.00" and small amounts with leading zero ("K0.05")
- [ ] formatKina renders negatives as "-K50.00"
- [ ] formatKina groups millions ("K10,000,000.00")
- [ ] amountProblem: no message up to K10,000,000.00
- [ ] amountProblem: a message above K10,000,000.00 (validation, not an error)
- [ ] property: formatKina ∘ parseKina round-trips every amount in range
- [ ] property: parseKina never returns a non-integer

## gst.ts (§3.2)
- [ ] gstOn is 10% exactly on round amounts (240000 → 24000)
- [ ] gstOn rounds half a toea up (5 → 1, 4 → 0, 15 → 2)
- [ ] gstOn mirrors negatives, half away from zero (-5 → -1, -4 → 0)
- [ ] isTaxable: unregistered org never charges GST, even with an explicit taxable line
- [ ] isTaxable: treatment taxable is taxable
- [ ] isTaxable: treatment exempt is exempt, even on commercial space
- [ ] isTaxable: inherit is taxable for commercial use
- [ ] isTaxable: inherit is exempt for residential use
- [ ] isTaxable: an unknown treatment throws, not a silent exemption
- [ ] documentTitle: "TAX INVOICE" when registered and any line taxable
- [ ] documentTitle: "INVOICE" when registered but no line taxable
- [ ] documentTitle: "INVOICE" when unregistered
- [ ] orgProblems: a registered org without a GST number is a validation error
- [ ] orgProblems: a registered org with a GST number is fine; whitespace-only counts as missing
- [ ] property: gstOn(-x) === -gstOn(x)
- [ ] property: gstOn(x) is within half a toea of x/10

## period.ts (§3.3)
- [ ] parsePeriod accepts "2026-10" (trimmed)
- [ ] parsePeriod rejects "2026-13", "2026-00", "october", "2026-1", ""
- [ ] nextPeriod / previousPeriod roll over the year
- [ ] firstDay / lastDay of a period, incl. leap February
- [ ] day() clamps the 31st to the 30th / 28th / 29th
- [ ] periodLabel is "October 2026"
- [ ] shortCode is "OCT26"
- [ ] addDays crosses month and year ends
- [ ] localDate gives the landlord's calendar day in their timezone, not UTC's
- [ ] zonedInstant converts a local date and hour in Port Moresby to UTC
- [ ] property: next(previous(p)) === p

## billing.ts - drafting (§3.4)
- [ ] isActiveIn: a tenancy starting after the month is not active
- [ ] isActiveIn: a tenancy that ended before the month is not active
- [ ] isActiveIn: a tenancy ending mid-month is still active; an open-ended one is active
- [ ] chargeApplies: an inactive charge never applies
- [ ] chargeApplies: an `every` charge applies every month
- [ ] chargeApplies: a `one` charge applies only in its named month
- [ ] paymentReference is "{CODE}-{SHORT}" upper-cased (wari → WARI-OCT26)
- [ ] draftInvoice: rent-only residential invoice (line, detail, no GST, totals, title)
- [ ] draftInvoice: issue date clamps the billing day; due date = issue + dueDays
- [ ] draftInvoice: commercial rent for a registered org carries GST and a tax invoice
- [ ] draftInvoice: a recurring charge follows the rent with the period label as detail
- [ ] draftInvoice: a one-month charge has an empty detail
- [ ] draftInvoice: charges keep the order they were added in
- [ ] draftInvoice: a credit reduces the total
- [ ] draftInvoice: an extra inherits the commercial treatment; an exempt override is honoured
- [ ] draftInvoice: an unregistered landlord letting commercial space charges no GST
- [ ] withRent: changes the rent line and recomputes GST and totals from the lines
- [ ] withRent: a negative rent is refused
- [ ] chargeProblems: a `one` charge needs its month; an `every` charge must not name one
- [ ] property: total === subtotal + gst === Σ lines, for any lines

## billing.ts - scheduling (§3.4)
- [ ] sendAt: the earliest billing day among active tenancies, at sendHour local, in UTC
- [ ] sendAt: day 1 when no tenancy is active
- [ ] periodsToDraft: nothing long before the lead time
- [ ] periodsToDraft: the period is due inside the lead time
- [ ] periodsToDraft: a period that already has a run is skipped
- [ ] periodsToDraft: a period with no active tenancy is skipped
- [ ] periodsToDraft: considers next month as well as this one (in the org's timezone)
- [ ] periodsToDraft: a new landlord is not billed for a month already gone
- [ ] periodsToDraft: an established landlord catches up after an outage (earlier run exists)
- [ ] periodsToDraft: next month's run does not make this month look like history

## billing.ts - state machine (§3.5, §6.4)
- [ ] isEditable for draft, awaitingApproval, held only
- [ ] approvalRequestDue: a draft run once now >= sendAt - leadDays (24 h periods)
- [ ] releaseDue: an approved run once now >= sendAt; never an unapproved one
- [ ] holdDue: an awaitingApproval run once now >= sendAt; never an approved one
- [ ] approvalOutcome: approving an approved or sent run is a no-op (I4)
- [ ] approvalOutcome: approving a held run is allowed (late approval)
- [ ] approvalOutcome: approving a cancelled run is refused
- [ ] canExclude / canInclude only while the run is editable
- [ ] canMarkPaid only a sent invoice; marking paid twice keeps the first date
- [ ] numbering: invoice numbers are prefix + zero-pad(4)
- [ ] numbering: included invoices are numbered by tenant name, then tenancy id
- [ ] numbering: excluded invoices get no number

## billing.ts - reminders (§3.6)
- [ ] reminderDue: not before dueDate + reminderAfterDays; on that day it is due
- [ ] reminderDue: zero days means due on the due date itself (reference: `day >= due + 0`)
- [ ] reminderDue: a paid invoice is left alone
- [ ] reminderDue: an invoice not `sent` is left alone (draft, approved, void)
- [ ] reminderDue: a paused invoice is left alone
- [ ] reminderDue: an already-reminded invoice is left alone (I8, at most once)
- [ ] reminderDue: reminders off for the org means none
- [ ] reminderDue: an invoice with no sentAt is never chased
