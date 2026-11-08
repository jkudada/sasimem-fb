# Test list: templates, logo builder, HTML email, sign-up

Written before the code (plan §9.1), from `docs/PLAN-TEMPLATES.md`. Ticked as each
goes red → green. Grouped by phase, then tier.

## P1: layouts, templates, org default, preview

### core (T1)
- [ ] `resolveTemplate` with no templates and no default gives built-in Classic with today's colours
- [ ] the org default is used when set; a dangling default id falls back to Classic
- [ ] `invoiceSnapshot` freezes the resolved template's settings (not its id alone)
- [ ] template validation mirrors the rules: name 1-40, layout/accent/font/mark enums, footer ≤ 200

### Security rules (T2)
- [ ] an owner creates, updates and deletes a template; a member only reads; a stranger nothing
- [ ] a bad layout, an off-palette accent, an unknown font or mark, a long footer or an extra key is refused
- [ ] an owner sets `defaultTemplateId`; any string not matching an id pattern is refused
- [ ] the browser cannot write `template` into an invoice snapshot (I9, unchanged)

### Functions (T3)
- [ ] approval freezes the org default template into every snapshot
- [ ] editing or deleting the template after approval does not change the rendered PDF (I5)
- [ ] an invoice whose snapshot has no `template` renders byte-identical to today's golden PDF
- [ ] golden text per layout (Classic, Band, Compact) via pdf-text
- [ ] every layout × {residential, commercial GST-registered} shows: TAX INVOICE/INVOICE title, number, dates, GST number when taxable, bill-to, lines, GST column only when taxable, totals, bank, payment reference
- [ ] every layout × each font × each mark renders deterministically (same input, same bytes)
- [ ] every layout with a 200 KB logo and 11 lines stays ≤ 150 KB and on one page
- [ ] the footer prints on every layout and is absent when empty
- [ ] `previewInvoicePdf`: owner only, App Check enforced, returns a PDF, stores nothing

### Web (T1)
- [ ] the templates list shows the default first, marked as default
- [ ] creating a template from a layout saves it and it appears in the list
- [ ] the SVG sketch changes when layout, accent or mark changes
- [ ] a template in use cannot be deleted; the screen says where it is used
- [ ] "Open a sample PDF" calls the callable and opens the bytes

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
- [ ] build a logo → create a Band template → set it as default → override one tenancy with Compact → draft → approve → the two PDFs use their templates
- [ ] an invited user signs up, verifies, creates an org, and reaches Home
