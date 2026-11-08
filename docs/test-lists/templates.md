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

All items done. Choices made while building (say if any is wrong):
- **"Use default" names what it means**: "Use default (Shops)" on a property is the org's
  default; on a tenancy it is the property's template, else the org's.
- **The Template choice appears only once a template exists**; before that every invoice
  is Classic, so there is nothing to choose.
- **The review screen and approval page show "Template: …" only when the org has templates**,
  for the same reason. Before approval it is what approval would pick now; after, the
  frozen one.
- **A template a property or tenancy uses cannot be deleted** (the editor says how many use
  it), like the default. If one goes anyway, approval falls through to the next level.
- **A form opened on a deleted template shows "Use default"**, and saving clears the stale id.

### core (T1)
- [x] tenancy override beats property, property beats org default; dangling ids fall through level by level
- [x] a template the default, a property or a tenancy uses cannot be deleted; the message counts them

### Security rules (T2)
- [x] `templateId` is optional on properties and tenancies; any other new key is still refused
- [x] setting `templateId` on a tenancy does not trip the copies guard

### Functions (T3)
- [x] one run with three tenancies (default, property override, tenancy override) freezes three templates
- [x] a deleted override falls through at approval
- [x] the approval page shows each invoice's template name (escaped)

### Web (T1)
- [x] property and tenancy forms offer "Use default" first, then the templates
- [x] the review screen shows each invoice's template

### T4
- [x] journey 6: a tenancy overrides the default; review shows it; approval freezes it

## P3: logo builder

All items done. Choices made while building (say if any is wrong):
- **Fonts:** Modern (Work Sans), Classic (Lora), Sturdy (Roboto Slab), Handwritten
  (Pacifico); open licences, Latin subset, about 88 KB together, fetched only by the builder.
- **Icons are drawn for Sasimem** (house, building, key, palm, wave, mountain, leaf, star),
  not taken from an icon set.
- **Colours:** the 8 invoice colours plus white and ink. White text needs a shape behind
  it, and text cannot match its shape's colour (it would not show).
- **A badge (circle or rounded square) is 400 × 400; "No shape" is a wordmark** 160 px high
  and as wide as its text (up to 400), which suits the letterhead's wide space.
- **Band's white plate now hugs the logo** instead of a fixed 160-point box, so a square
  logo has no blank beside it.
- **The logo model is `@sasimem/core/logo`**, not in core's main export: there it changed
  how Vite split the sign-in route's chunks (+2 KB). The sign-in route is unchanged.
- **Fix found on the way:** a journey's first callable can meet a cold Functions emulator;
  the shared draft step now waits up to 30 s.

### core (T1)
- [x] a first design is the org's initials; text 1-24; unknown shape/font/icon/colour refused; text that would not show refused

### Web (T1)
- [x] the builder draws the text, shape, colours, font and icon chosen
- [x] saving draws one PNG and saves it with the design (the real PNG: ≤ 400 px and ≤ 200 KB, checked in journey 7)
- [x] reopening the builder restores every choice
- [x] uploading a file instead clears `logoDesign`; removing the logo clears both (journey 7)
- [x] text over 24 characters or empty is refused with a message
- [x] every shape × icon × font, short or long text, lays out within 400 px with the text inside

### Security rules (T2)
- [x] `logoDesign` validates every field; an owner only

### Budgets
- [x] the builder's JS and fonts load only on its route (journey 7 watches the requests); the sign-in route budget is unchanged (50.79 KB); the builder's own JS ≤ 8 KB

### T4
- [x] journey 7: build a logo → Band template as default → approve → the PDF carries the logo; reopen, upload instead, remove

## P4: HTML email

All items done. Choices made while building (say if any is wrong):
- **Resend's inline images are confirmed** (an attachment with `content_id`, shown as
  `cid:` in the HTML), so the logo goes inline; no fallback was needed.
- **Each email is written once** as a greeting and blocks (letter.ts) and rendered to both
  parts, so the text and HTML cannot drift. The text bodies read as before.
- **The template's note now ends the tenant's email too**, in both parts (it was on the
  PDF only).
- **Tenant emails:** the accent as a top rule, the org's name in it, the logo (fitted to
  160 × 60, as on the PDF), or initials, or nothing, as the template says; the template's
  font family. A lost logo gives initials and the email still goes.
- **Landlord emails:** the house style, Sasimem green, no logo.
- **The dispatch notice's tenant lines are a two-column table in HTML.**

### Functions (T3)
- [x] the tenant invoice email has a text and an HTML part saying the same facts
- [x] the HTML uses the invoice's frozen template (accent, logo inline by content id, footer)
- [x] a tenant or property name containing `<script>` / `&` / quotes is escaped in HTML
- [x] the HTML has no remote images and no tracking; ≤ 20 KB before the logo
- [x] reminders are branded the same way; landlord emails use the house style
- [x] the approval link appears as visible text in both parts
- [x] golden HTML per email kind
- [x] the Resend adapter sends `html` and inline attachments; so does the Gmail adapter (nodemailer `cid`); the console mailer and outbox record them
- [x] sending from a stored logo: inline when the template shows it; a lost logo gives initials

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
- [x] (P2-P3) build a logo → Band default → approve → the PDF carries the logo (journey 7); a tenancy overriding the default (journey 6)
- [ ] an invited user signs up, verifies, creates an org, and reaches Home
