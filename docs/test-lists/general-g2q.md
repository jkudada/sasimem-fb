# Test list: G2q, quotes

Written before the code (PLAN-SASIMEM-FB §9.1), from `docs/PLAN-GENERAL-INVOICING.md` §3.3,
§5.2, §5.5 and D11-D18. Quotes are a shared feature for every module (D11). They are built in
three slices, each its own PR or pair of PRs:

| Slice | What |
|---|---|
| **G2q-a** | **Write and send a quote:** the quote editor, Settings (validity, terms), Send: numbered `QUO-`, frozen, PDF "QUOTATION", emailed with a link |
| G2q-b | **The customer's page** at `/q/**`: view, accept (name, PO number, "I accept these terms"), decline (reason). The owner is told. The owner can also record the answer by hand, or undo an acceptance. The tick marks quotes expired |
| G2q-c | **Revisions and converting:** revise a sent quote (same number, rev 2; the old link stops accepting); on acceptance an invoice draft is made (D14), in full or deposit + final (D13); quoted vs invoiced; the optional follow-up |

## Choices for all of G2q (say if any is wrong)

- **Behind `features.quotes`**, server-written like `oneOff`. Quotes are written for customers,
  and turn into one-off invoices, so `quotes` needs `oneOff` on too: the server refuses a quote
  for an org without `oneOff`. Switching on:
  `node ops/features.ts --project sasimem-dev --org <orgId> --on rentals,repeating,oneOff,quotes`.
- **The same shape as one-off invoices (G2a).** The owner writes a draft in
  `quoteDrafts/{id}` (owner-writable, like `drafts/`). **Send quote** is a callable,
  `sendQuote`, that checks it, takes the next `QUO-` number, freezes it and writes
  `quotes/{id}` (server-only, I9), makes the PDF and emails it. The draft goes. A quote that
  was sent is never edited; changing it is a **revision** (G2q-c).
- **Numbers:** `QUO-0001` onwards, from `nextQuoteNumber` on the same counter document, taken
  when first sent and never when drafted, so the numbers have no gaps. A revision keeps its
  number (`QUO-0012 rev 2`).
- **Not a tax document.** It prints "QUOTATION", with GST worked out as on an invoice so the
  customer sees the full price. Same lines, same 30-line limit, same templates and logo as
  invoices. The PO number is not asked for on a quote: the customer gives it when accepting.
- **Valid until (D17):** the day it is sent plus the quote's own days, else the org's
  `quoteValidDays` (30 when not set; 1-365, Settings). It prints "Valid until 19 December 2026".
- **Terms (D18):** one terms box per org, `quoteTerms` (up to 2,000 characters, Settings),
  printed under the lines on every quote and shown on the customer's page. Frozen with the
  quote. Not set means the default below (N11). An owner who clears it prints none.
- **The link:** a random token, kept only as its SHA-256 in `quoteTokens/{hash}` (top level,
  server-only) with `orgId`, `quoteId`, `revision`, as approval links are (I10). It works until
  60 days after the valid-until date, so a customer can still see an expired quote and read
  why it can no longer be accepted.
- **Quotes do not count against invoice limits** (§7) and are not in the CSV export of invoices.
- **Owner notices** (accepted, declined) go to the org's address on file, like every other
  owner email.
- **Between G2q-a and G2q-b** the email's `/q/` link has no page behind it yet. Nothing is
  deployed until G2q-b is merged too. Then the deploy needs `functions`, `hosting` (the `/q/**`
  rewrite) and `firestore:indexes` (quotes by status and validUntil).

### N11: default quote terms (Claude's first version; have an accountant or lawyer check it)

> 1. Prices are in kina. Where GST applies it is shown on each line and in the total.
> 2. This quote is valid until the date shown. After that the prices may change.
> 3. Work starts once you accept this quote. Accept it with the link in our email, or tell us.
> 4. We invoice when the work is done, unless a deposit is shown. A deposit is paid before
>    work starts and comes off the final invoice.
> 5. Payment is due by the date on the invoice, by bank transfer to the account shown on it.
> 6. Anything not listed in this quote is extra. We will quote it before doing it.
> 7. If you change or cancel the work after accepting, you pay for work already done and
>    materials already bought for it.

## G2q-a: write and send a quote

### core (T1)
- [x] `quoteDraftOf` reads a stored draft defensively (as `draftOf`); `quoteProblems`: no customer, no lines, over 30 lines, a bad line, a total below K0.00, validity days outside 1-365
- [x] `validUntilOf`: the send day plus the quote's days, else the org's, else 30
- [x] `quoteSettingsProblems`: `quoteValidDays` 1-365, `quoteTerms` up to 2,000 characters
- [x] `quoteTermsOf(org)`: the org's terms, the default (N11) when not set, none when cleared
- [x] `quoteLabel`: "QUO-0012", and "QUO-0012 rev 2" from revision 2 on

### Security rules (T2)
- [x] the owner creates, edits and deletes `quoteDrafts` (customer, lines, notes, validDays); members read them; the shape is checked as `drafts` are
- [x] members read `quotes`; nobody writes them; nobody reads or writes `quoteTokens`
- [x] the owner sets `quoteValidDays` (whole, 1-365) and `quoteTerms` (a string up to 2,000 characters)

### Functions (T3)
- [x] `sendQuote`: numbered `QUO-0001` from its own counter (invoices' counter untouched), frozen snapshot with terms and valid-until, status `sent`, revision 1, PDF stored, the token stored hashed, the draft gone, an event
- [x] emailed to the customer and copy-to, with the PDF and the link; the subject says the number, the business and the total
- [x] refused: no `quotes` (or no `oneOff`), not the owner, a missing draft, a draft with problems (in core's words)
- [x] two sends at once: one quote, one number, one email
- [x] the PDF prints "QUOTATION", the number, valid until, the lines, GST and total, and the terms

### Web (T1 web)
- [x] Home and the menu show Quotes only with `quotes` on
- [x] the quote editor: customer, lines from the price list, notes, valid for (days, the org's by default); Save draft; Send quote checks, saves, sends and shows "Sent QUO-0001 to Kila Trading"
- [x] the quotes list: drafts, then sent quotes with number, customer, total, valid until and status
- [x] Settings: "Days a quote is valid" and "Quote terms" (the default filled in), with quotes on only
- [x] the line editing is shared with the invoice editor (`LinesEditor`); the invoice editor's tests pass unchanged

### End to end (T4)
- [x] an owner writes a quote and sends it; the customer's email has the PDF and a `/q/` link

## G2q-b: the customer's page

### Choices
- **The page is server-rendered, with no JavaScript**, like the approval page (≤ 30 KB, the
  same look). It shows the business, the quote's lines and totals, valid until, the terms and
  a link to the PDF.
- **Opening the page marks the quote `viewed`** (once, with the time) if it was `sent`. The
  owner sees "Viewed" in the list. No email for a view.
- **The PDF, the page's forms and the owner's email** are served by one public function,
  `quotePage`, behind Hosting's `/q/**` rewrite, as `approvalPage` is behind `/a/**`. Its
  forms are signed with the same key (`APPROVAL_SIGNING_KEY`). Expiry needs a new
  collection-group index on `quotes` (status, validUntil), deployed with `firestore:indexes`.
- **Accept:** the customer types their name (required), optionally a PO number, and ticks
  "I accept these terms". Recorded on the quote as `acceptance` (by: customer, name, poNumber,
  at, revision, totalToea) and as an event. A form nonce, as on the approval page, stops a
  replayed or forged post.
- **Decline:** an optional reason (up to 500 characters). Recorded the same way.
- **Answered once.** After accepting or declining, the page shows the answer and its time;
  posting again changes nothing. An expired quote, or a superseded revision (G2q-c), cannot
  be accepted; the page says why and who to contact.
- **The owner is told at once** by email: "QUO-0012 accepted by Peter Kila" (with the PO
  number), or "QUO-0012 declined" with the reason. Home's count of accepted quotes not yet
  invoiced comes with G2q-c.
- **The owner can record the answer by hand** (the customer phoned, or signed paper), with the
  name and PO number, as `acceptance.by: "owner"`; or record a decline. No email to the owner
  for their own action.
- **Undo an acceptance** (plan §10, a forwarded link): the owner can set an accepted quote back
  to sent, until it is invoiced. Recorded as an event.
- **Expiry:** a tick step marks `sent` and `viewed` quotes `expired` once their valid-until day
  has passed in the org's time. Expired quotes can be revised (G2q-c).

### core (T1)
- [x] `readQuoteAnswer(form)`: accept needs a name (up to 100) and the tick; PO up to 40 (as on an invoice, where it goes next); decline reason up to 500
- [x] `quoteExpired(quote, now, timezone)`: after the valid-until day ends
- [x] which answers each status allows: sent and viewed take an answer; accepted can be undone until invoiced; the rest take none

### Functions (T3)
- [x] `GET /q/{token}`: the quote page; marks it viewed once; an unknown token gets a plain "link not recognised" page
- [x] `GET /q/{token}/pdf`: the frozen PDF
- [x] accept: recorded with name, PO, time, revision and total; the owner emailed once; the page shows it accepted
- [x] decline: recorded with the reason; the owner emailed once
- [x] refused: a second answer, a missing name or tick, a bad nonce, an expired quote, a link past its life
- [x] two accepts at once: recorded once, one email
- [x] `markQuote` (owner): accepted by hand with name and PO, or declined, with no email; refused for a non-owner, a missing name and quotes already answered
- [x] `undoAcceptance`: back to sent; refused once invoiced
- [x] the tick marks quotes expired after their day, once, and leaves answered ones alone

### Web (T1 web)
- [x] the quote screen: status, acceptance (who, when, PO) or the decline reason; Record an answer; Undo the acceptance
- [x] the quotes list shows Viewed, Accepted, Declined and Expired

### End to end (T4)
- [x] the customer opens the link, accepts with a PO number; the owner gets the email and the quote shows Accepted

## G2q-c: revisions and converting to an invoice

Built as two PRs, server then web (stacked), as G2q-b was.

### Choices
- **Revise:** on a sent, viewed, declined or expired quote, **Revise** copies it into a draft,
  `quoteDrafts/{quoteId}_rev` with `revises: quoteId` (one revision draft per quote, so
  pressing Revise twice opens the same draft). It is edited like any quote draft. Sending it
  makes the next revision of the same quote: the same number, `revision` + 1, a new snapshot,
  PDF and link, valid-until from the new send day, terms as they are now. The earlier revision
  is kept in `quotes/{id}/revisions/{n}` (its snapshot, totals, answer and PDF path). Its link
  shows "This quote was replaced" (G2q-b) and stops accepting. The new revision starts `sent`,
  with no view, answer or expiry. An accepted quote is not revised (undo the acceptance first).
  The email says "QUO-0012 rev 2 (replaces rev 1)".
- **A revision and an answer at once:** whichever lands first wins. A customer accepting rev 1
  while the owner sends rev 2 either accepts rev 1 (and the send is refused: "QUO-0012 was
  accepted while you were revising it") or is told the quote was replaced.
- **On acceptance an invoice draft is made automatically (D14)**, in the same transaction as
  the acceptance (by the customer's link or recorded by the owner). It is an ordinary
  `drafts/` draft with the id `{quoteId}_r{rev}_full` (or `_deposit`), so it is made once per
  revision and the invoice it becomes has that id too. It has the customer, the lines, the PO
  number, and the quote's notes followed by "Quote QUO-0012 rev 2, accepted by Peter Kila on
  20 November 2026." The quote's terms are not copied: the invoice has its own payment terms.
  The owner can edit it, and presses Send (D7). Nothing is invoiced without their say-so.
- **Undoing an acceptance** deletes its draft if it is still a draft. Once an invoice from the
  quote is sent, the acceptance cannot be undone (G2q-b).
- **Deposits (D13), off by default:** a per-org setting "Ask for a deposit of __% on quotes
  over K__" (`depositPercent` 1-100, `depositOverToea` K0.00 or more; no percent means off).
  When the accepted total is over that amount, the draft is a deposit invoice
  (`_deposit`): a line "Deposit for QUO-0012" at that share of the lines' amount before GST,
  **one line per tax code** the quote uses (standard, zero, exempt), so GST on the deposit is
  exactly what it would be on that share of the work. The quote screen lets the owner switch
  the draft between "deposit" and "in full" while nothing from the quote has been sent.
- **The final invoice** (`_final`) is drafted when the owner presses "Invoice the rest" on the
  quote, after the deposit invoice is sent. It has the quote's lines, then the deposit's lines
  again as negative lines ("Less deposit, INV-0040"). A negative line's GST mirrors the
  charge, so the deposit and final invoices together charge exactly the quote's total and GST,
  each counted once.
- **Quoted vs invoiced:** when an invoice made from a quote is sent (`issueOneOff`, known by
  its id), the same transaction adds it to the quote's `invoiceIds` and its total to
  `invoicedToea`. The quote becomes **Invoiced** (a new status) once `invoicedToea` reaches the
  accepted total. More than that is allowed but flagged on the quote: "K1,200.00 more than the
  accepted quote". Credit notes against those invoices are not taken off `invoicedToea`
  (a credited invoice was still invoiced; the credit note shows on the invoice).
- **Home:** "2 accepted quotes not invoiced" for quotes accepted more than 7 days ago with
  nothing sent from them (AR-1). It links to the quotes list.
- **Follow-up, off by default:** one reminder to the customer, N days after sending
  (`quoteFollowUpDays`, 1-60, Settings, absent = off), if the quote is still `sent` or
  `viewed` and not expired. Once per revision (`followedUpAt`). It is the hourly tick's step
  8, to the customer and copy-to as the quote, with a **fresh link to the same revision** (only
  links' hashes are kept, I10, so the first link cannot be sent again): "A reminder about quote QUO-0012 from
  {business}". Turning the setting off stops reminders not yet sent. The send time is fixed
  when the quote is sent (`followUpAt`), so the tick's query needs a new index on `quotes`
  (status, followUpAt).
- **The final invoice can pass 30 lines** (a 30-line quote plus up to three deposit lines). It
  is still drafted; Send then says it has too many lines, and the owner combines some.
- **Draft ids with `_`:** invoice and quote drafts made by the server have ids like
  `{quoteId}_r1_full` and `{quoteId}_rev`, so Send invoice and Send quote take letters,
  digits and `_`.
- **Fixed on the way:** the owner's "accepted" email linked to `/quotes/{id}` (the draft
  editor); it now links to the quote's screen, `/quotes/sent/{id}`.
- **Deploy:** `functions`, `firestore:rules` (the new settings and `revises`), and
  `firestore:indexes`.

### core (T1)
- [x] `quoteDraftOf` keeps `revises`; `quoteProblems` is unchanged for a revision
- [x] `quoteAllows(q).revise`: sent, viewed, declined and expired; not accepted or invoiced
- [x] `revisionDraftOf(quote)`: the lines, customer, notes and valid days of the quote, with `revises`
- [x] `quoteSettingsProblems`: `depositPercent` whole 1-100, `depositOverToea` whole toea 0 or more, `quoteFollowUpDays` whole 1-60
- [x] `depositApplies(org, totalToea)`: off without a percent; on only over the amount
- [x] `invoiceDraftFromQuote(quote, "full" | "deposit", acceptance, org)`: the full draft (lines, customer, PO, notes with the acceptance line); the deposit draft (one line per tax code, at the share of each code's amount, rounded to the toea)
- [x] `finalDraftFromQuote(quote, depositInvoice)`: the quote's lines and the deposit's lines negated; property: deposit + final = the quote's subtotal, GST and total, for any lines and percent
- [x] `quoteInvoiced(q)`: Invoiced at the accepted total; the amount over it, if any
- [x] `quoteFromDraftId(id)`: reads `{quoteId}_r{rev}_{full|deposit|final}` back; null for any other id
- [x] `followUpDue(q, org, now)`: sent or viewed, not expired, not followed up, past `followUpAt`, the setting still on

### Security rules (T2)
- [x] the owner writes a quote draft with `revises` (a string); others' shape rules unchanged
- [x] the owner sets `depositPercent`, `depositOverToea` and `quoteFollowUpDays` (whole, in range) and clears them
- [x] the owner edits and deletes a draft made from a quote, as any draft; nobody writes `quotes/{id}/revisions`; members read them

### Functions (T3)
- [x] `sendQuote` with `revises`: the same number, revision 2, a new token, PDF and valid-until; rev 1 kept under `revisions/1`; the old link says replaced and refuses a post; the draft gone; an event
- [x] revising is refused for an accepted quote, a quote of another org, or a draft whose quote is gone
- [x] a revision and an acceptance at once: exactly one wins
- [x] accepting (link or owner) makes the draft `{id}_r1_full`, once, with the lines, PO and acceptance note; two accepts still make one
- [x] with a deposit setting that applies, the draft is `_deposit` with one line per tax code
- [x] `draftFromQuote(id, "full" | "deposit")`: switches the draft while nothing is sent; refused after
- [x] `draftFromQuote(id, "final")`: after the deposit invoice is sent; made once
- [x] sending an invoice from a quote adds it to `invoiceIds` and `invoicedToea`; the quote becomes Invoiced at the accepted total; flagged over it
- [x] undoing an acceptance deletes its unsent draft; refused once an invoice from it is sent
- [x] the tick's follow-up: sent once after N days, with the link; not for answered, expired or followed-up quotes, or with the setting off; the email logged

### Web (T1 web)
- [ ] the quote screen: Revise (sent, viewed, declined, expired) opens the revision draft; the revisions listed with their dates
- [ ] the quote screen after acceptance: the invoice draft linked; "Deposit" / "In full" switch while nothing is sent; Invoice the rest after the deposit is sent; invoices from the quote with their totals; Invoiced, or the amount over
- [ ] the quote editor shows "Revising QUO-0012" and sends as "Send revision 2"
- [ ] Settings: the deposit percent and amount, and follow-up days, with quotes on only
- [ ] Home: "2 accepted quotes not invoiced" after 7 days
- [ ] the quotes list shows Invoiced

### End to end (T4)
- [ ] the owner revises a sent quote; the customer's new link accepts it and the old one says replaced; the invoice draft is there; the owner sends it and the quote shows Invoiced
