# Invoice templates, logo builder, branded email, open sign-up

Status: **planned, not started.** Decisions below were agreed with the user on
2026-11-08. Builds on `docs/PLAN-SASIMEM-FB.md` (it answers that plan's open
question 3, "invoice templates", and question 4, "who signs up").

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Who can have a different template? | **Renters.** An org default, overridable per **property** and per **tenancy**; the most specific wins |
| D2 | Different businesses per property (name, bank, GST number)? | **No.** One business identity per org; templates change the look only |
| D3 | Logo tool | A **monogram / wordmark builder** (text, shape, colours, font, optional icon from a small set). No free canvas, no AI. Upload stays |
| D4 | How many layouts | **Three**, written in code: Classic (today's), Band, Compact |
| D5 | Does a template change reach invoices already approved? | **No.** The resolved template is frozen into the invoice snapshot at approval (I5 untouched) |
| D6 | Branded email | **Yes, HTML**, always with the plain-text part kept |
| D7 | Is this tied to opening sign-up? | **Yes.** Sign-up opens at the end of this work (§7) |

## 2. Invariants this work must keep

- **I5 / determinism.** A PDF is rendered once, from the snapshot alone. So the
  snapshot carries the template's *settings*, not a reference to a template doc.
- **I9.** Templates and the logo design are setup data: owners write them under
  rules. Snapshotting happens only in the approval transaction (Functions).
- **Tax invoice content.** Every layout prints the same content model; only the
  arrangement differs. A test proves each layout carries the tax-invoice fields.
- **Budgets.** PDF ≤ 150 KB with a logo; built-in PDF fonts only (Helvetica,
  Times); the template and logo screens are lazy routes, outside the sign-in budget.
- **Existing invoices unchanged.** A snapshot with no `template` renders as
  Classic with today's colours, so the golden file and every issued PDF stay as they are.

## 3. Data model

```
orgs/{orgId}
  defaultTemplateId?   string            # absent → built-in Classic
  logoDesign?          map               # the builder's inputs, to re-edit (§5)
  logoPath?            string            # unchanged; the builder writes a PNG here

orgs/{orgId}/templates/{templateId}      # at most 10 per org
  name      string 1-40
  layout    'classic' | 'band' | 'compact'
  accent    one of a fixed palette of ~8 hex colours (print-safe, contrast-checked)
  font      'helvetica' | 'times'
  mark      'logo' | 'monogram' | 'none' # 'logo' falls back to monogram if none uploaded
  footer    string 0-200                 # e.g. "Thank you. Rent is due on the 1st."

orgs/{orgId}/properties/{id}   + templateId?   (optional key)
orgs/{orgId}/tenancies/{id}    + templateId?   (optional key; not a "copy", so the
                                                sync trigger is unaffected)

InvoiceSnapshot  + template: { name, layout, accent, font, mark, footer }   # resolved, frozen
```

- **Resolution** is a pure `core` function:
  `resolveTemplate({ tenancy, property, org, templates })` → tenancy's → property's →
  org default → built-in Classic. A dangling id (template deleted) falls through to
  the next level; it never fails an approval.
- **Deleting a template in use** is blocked in the UI (like core's `deleteProblem`)
  and survivable if it happens anyway (previous point).
- The approval transaction reads the org's templates and the tenancies' properties
  (≤ 20) and freezes the result. Review and approval screens show each invoice's
  template name.

## 4. Templates and preview

- `pdf.ts` splits into a shared **content model** (`invoiceContent(invoice)` → the
  facts, lines, totals, payment block) and three **layout** functions that draw it.
  Accent, font, mark and footer are parameters.
- **Settings → Invoice templates:** list, create (start from a layout), edit, set
  as default, delete. Property and tenancy forms get a "Template" select
  ("Use default" first).
- **Preview.** Android Chrome does not show PDFs inline, so:
  - a **live SVG sketch** in the editor, drawn from the same content model
    (shapes and positions, not pixel-exact), updates as settings change;
  - **"Open a sample PDF"** calls `previewInvoicePdf` (owner only, App Check,
    low `maxInstances`), which renders the real PDF for a fixed sample invoice
    with the org's details and current logo, and returns bytes (as `invoicePdf`
    does; the Storage emulator cannot sign URLs). Nothing is stored.

## 5. Logo builder

- A lazy route, phone-first. Inputs: text (initials or short name, 1-24 chars),
  shape (circle, rounded square, none), background and text colours (palette),
  font (4 web fonts, subset woff2, loaded only by this route), optional icon
  (house, building, key, palm, wave, mountain, leaf, star: inline SVG paths).
- Drawn as SVG; on save it is rasterised in the browser to a **PNG ≤ 400 px**
  (transparent background) and uploaded through the existing `uploadLogo`, then
  `logoDesign` is saved so the builder reopens with the same choices.
- So the PDF, Storage rules, the 200 KB cap, snapshots and the monogram fallback
  all work unchanged. Uploading a file still works and clears `logoDesign`.
- Logo files are never deleted (every upload has a new name), so an approved
  invoice whose PDF is not yet rendered always finds its logo.

## 6. Branded HTML email

- `Mail` gains `html?` and inline attachments (`contentId`). The Resend adapter
  passes both; the console mailer and outbox record them. *Verify Resend's
  inline-image (`content_id`) support when building; if absent, the header
  falls back to the org name in the accent colour, no image.*
- **Tenant emails** (invoice, reminder) use the invoice's frozen template: the
  logo as an inline image, the accent colour, the org name, the amount, the due
  date and payment reference, the footer. **Landlord emails** (digest, held,
  dispatch, fresh link) get one plain house style.
- Rules: table layout with inline styles, one column, ≤ ~20 KB plus the logo; no
  remote images, no tracking; **every interpolated value HTML-escaped** (tenant
  and property names are user input); the text part is always sent and says the same.
- The digest/approval link stays a plain link; no buttons that hide the URL.

## 7. Opening sign-up (D7)

Prerequisites (the user's actions, or on prod the user's alone):
- a real `RESEND_API_KEY` and the sending domain's SPF/DKIM/DMARC verified
  (`docs/runbooks/sending-domain.md`); today every email fails with 401;
- sign-up re-enabled in Firebase Auth (it is disabled in dev since 2026-11-08).

Build:
- **Invite allow-list first** (plan question 4's recommendation): `createOrg`
  refuses an email not in `signupInvites/{email}` (server-only collection),
  with a clear message; `ops/invite.ts --project <id> <email>` adds one.
  Lifting the list later is one parameter (`SIGNUP_MODE=invite|open`).
- **Verified email before an org exists:** `createOrg` requires
  `email_verified`; sign-up sends the verification email and the onboarding
  screen waits for it. (Stops throwaway accounts sending mail as us.)
- The sign-in screen's "Something went wrong" for a refused sign-up becomes a
  real message ("Sign-up is by invitation for now").

## 8. Phases (each a PR, stopping for review)

| Phase | Content | Estimate |
|---|---|---|
| P1 | Content model + 3 layouts; templates collection, rules, Settings screens; org default; snapshot + resolution (org default only); SVG sketch + sample PDF | ~1 week |
| P2 | Property and tenancy overrides; resolution through all levels; template shown on review and approval screens | 2-3 days |
| P3 | Logo builder | ~1 week |
| P4 | HTML email (tenant branded, landlord house style) | 3-4 days |
| P5 | Sign-up: invite allow-list, verified email, messages; reopen in dev | 2-3 days |

P1-P2 can ship before P3: templates work with the uploaded logo or the monogram.

## 9. Open points (non-blocking)

1. **Invite-only or open?** P5 builds invite-only with a switch. Say if you want
   it open from day one.
2. **The accent palette.** I will propose ~8 colours in P1 for you to approve.
3. **Branch base.** This branch sits on the stacked step PRs (#3 → #9 chain), not
   on `main`; those should merge first, or P1's PR is stacked on #9.
