# Test list: templates, logo builder, HTML email, sign-up

Written before the code (plan §9.1), from `docs/PLAN-TEMPLATES.md`. Ticked as each
goes red → green. Grouped by phase, then tier.

## P1: layouts, templates, org default, preview

All items done. Choices made while building (say if any is wrong):
- **Classic's colour colours only the initials circle**, so an invoice approved before
  templates (or under default Classic) stays byte-identical. Band uses the colour for the
  band, title, table heading, total and a box round the reference; Compact for one rule.
- **The "footer" prints as a note beside the totals**, not at the foot of the page: at the
  foot it collided with the payment block on long invoices.
- **The templates list shows a dot of colour and "Band · Ocean · Traditional"**, not a
  sketch per row; the full sketch is in the editor.
- **A first template is offered as the default** (ticked); later ones are not.
- **Fix found on the way:** eleven charged lines already ran onto a second page, and a long
  description overlapped the next line. Both fixed; Classic tightens spacing only when it
  would not otherwise fit, so ordinary invoices are unchanged.
- **The 10-template cap is UI-only**, like the delete guards (rules cannot count).

### core (T1)
- [x] `resolveTemplate` with no templates and no default gives built-in Classic with today's colours
- [x] the org default is used when set; a dangling default id falls back to Classic
- [x] `invoiceSnapshot` freezes the resolved template's settings (not its id alone)
- [x] template validation mirrors the rules: name 1-40, layout/accent/font/mark enums, footer ≤ 200
- [x] every palette colour is at least 4.5:1 against white
- [x] the sample invoice: the org's details, a sample tenant, this month; a tax invoice for a GST-registered org

### Security rules (T2)
- [x] an owner creates, updates and deletes a template; a member only reads; a stranger nothing
- [x] a bad layout, an off-palette accent, an unknown font or mark, a long footer or an extra key is refused
- [x] every layout, colour, font and mark core offers is accepted (the rules' list matches core's)
- [x] an owner sets and clears `defaultTemplateId`; any string not matching an id pattern is refused
- [x] the browser cannot write `template` into an invoice snapshot (I9, unchanged)

### Functions (T3)
- [x] approval freezes the org default template into every snapshot
- [x] editing or deleting the template after approval does not change the snapshot or the rendered PDF (I5)
- [x] an invoice whose snapshot has no `template` renders byte-identical to today's golden PDF
- [x] golden text per layout (Classic, Band, Compact) via pdf-text
- [x] every layout × {tax, plain} shows: title, number, dates, GST number when taxable, bill-to, lines, GST only when taxable, totals, bank, payment reference
- [x] every layout × each font × each mark renders deterministically (same input, same bytes)
- [x] every layout with a large logo, 11 lines (one wrapping) and a 200-character note stays ≤ 150 KB and on one page
- [x] the note prints on every layout and is absent when empty; the marks draw logo / initials / nothing
- [x] `previewInvoicePdf`: owner only, App Check enforced, at most 5 instances, returns a PDF, stores nothing

### Web (T1)
- [x] the templates list shows the default first, marked as default; built-in Classic when there is none
- [x] creating a template from a layout saves it (and makes it the default when ticked)
- [x] the SVG sketch changes when layout, accent, font, mark or note changes
- [x] the default template cannot be deleted; the screen says what to do instead
- [x] "See a sample PDF" calls the callable with the settings on screen
- [x] at 10 templates there is no "New template"

### T4
- [x] journey 5: make a Band template the default, download its sample PDF, approve an invoice, and it is frozen with the template

## P2: overrides

### core (T1)
- [ ] tenancy override beats property, property beats org default; dangling ids fall through level by level

### Security rules (T2)
- [ ] `templateId` is optional on properties and tenancies; any other new key is still refused
- [ ] setting `templateId` on a tenancy does not trip the copies guard

### Functions (T3)
- [ ] one run with three tenancies (default, property override, tenancy override) freezes three templates
- [ ] the approval page shows each invoice's template name (escaped)

### Web (T1)
- [ ] property and tenancy forms offer "Use default" first, then the templates
- [ ] the review screen shows each invoice's template

## P3: logo builder

### Web (T1)
- [ ] the builder draws the text, shape, colours, font and icon chosen
- [ ] saving uploads one PNG ≤ 400 px and ≤ 200 KB, then saves `logoDesign`
- [ ] reopening the builder restores every choice
- [ ] uploading a file instead clears `logoDesign`; removing the logo clears both
- [ ] text over 24 characters or empty is refused with a message

### Security rules (T2)
- [ ] `logoDesign` validates every field; an owner only

### Budgets
- [ ] the builder's JS and fonts load only on its route; the sign-in route budget is unchanged

## P4: HTML email

### Functions (T3)
- [ ] the tenant invoice email has a text and an HTML part saying the same facts
- [ ] the HTML uses the invoice's frozen template (accent, logo inline by content id, footer)
- [ ] a tenant or property name containing `<script>` / `&` / quotes is escaped in HTML
- [ ] the HTML has no remote images and no tracking; ≤ 20 KB before the logo
- [ ] reminders are branded the same way; landlord emails use the house style
- [ ] the approval link appears as visible text in both parts
- [ ] golden HTML per email kind
- [ ] the Resend adapter sends `html` and inline attachments; the console mailer and outbox record them

## P5: sign-up

### Functions (T3)
- [ ] in invite mode, `createOrg` refuses an email with no invite, with a clear message
- [ ] in invite mode, an invited, verified email creates its org; the invite is used up
- [ ] `createOrg` refuses an unverified email in either mode
- [ ] in open mode, any verified email creates an org
- [ ] the browser cannot read or write `signupInvites` (T2)

### Web (T1)
- [ ] after sign-up the onboarding screen asks the user to verify, and continues once verified
- [ ] a refused sign-up shows "Sign-up is by invitation for now", not "Something went wrong"

### Ops (T1)
- [ ] `ops/invite.ts` refuses to run without `--project`, and adds an invite

## T4 journeys (Playwright, emulators, 360 × 740)
- [ ] (P2-P3) build a logo → create a Band template → set it as default → override one tenancy with Compact → draft → approve → the two PDFs use their templates
- [ ] an invited user signs up, verifies, creates an org, and reaches Home
