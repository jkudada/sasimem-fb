# Rent Invoicing SaaS — System Plan

**Market:** Papua New Guinea (reference market), designed to generalise
**Audience:** Small "accidental" landlords with 1–20 tenancies
**v1 money scope:** Invoices only; landlord marks paid by hand
**Core promise:** Set and forget — but nothing goes out without your say-so

---

## 1. The product in one sentence

A landlord sets up their tenants once; every month the system drafts the invoices,
emails the landlord a single one-click approval, and then sends the approved
invoices to tenants on schedule.

## 2. Who this is for

Landlords with 1–20 tenancies who are **not** property managers and **not**
accountants. They currently invoice from memory, a Word file, or a WhatsApp
message. They are on a mid-range Android phone far more often than a laptop, on
a connection where data costs real money.

Design consequences: phone-first, tiny payloads, no jargon, and a manual override
on everything.

## 3. The core loop — this *is* the product

```
 Day −3   System generates draft invoices for the upcoming period
    │
    ▼
          ONE digest email to the landlord:
          "5 invoices ready for October — K6,400 total. Review →"
    │
    ▼
 Landlord opens a signed link (no password), sees the 5 drafts,
 edits an amount, excludes one, taps "Approve all"
    │
    ▼
 1st of month, 08:00 PNG   System emails each tenant their PDF invoice
    │
    ▼
 Money arrives → landlord ticks "paid"
 Day +7 unpaid → gentle reminder (approval-gated or automatic, configurable)
```

### Three decisions that define the product

1. **Silence never means send.** If the landlord doesn't approve before the send
   time, the batch is *held*, not sent, and the landlord is told it was held.
   This is the trust anchor. Every other feature is negotiable; this one isn't.
2. **Batch approval, not per-invoice.** One email per month covering all tenants,
   not one email per tenant. The whole point is fewer decisions, not more.
3. **Approval needs no login.** A signed, expiring, single-use URL. A landlord on
   a phone in a car park must be able to approve in two taps without recalling a
   password. Password login exists for setup; approval doesn't require it.

## 4. PNG findings that shape the build

| Finding | Consequence |
|---|---|
| Residential accommodation is **GST-exempt** | Residential invoices carry no GST line at all |
| Commercial rent is taxable at **10% GST** | GST-registered landlords letting commercial space need a true *tax invoice* |
| Tax invoices (supplies over **K50**) must show GST registration number, date, description, GST amount | Template must switch between "INVOICE" and "TAX INVOICE" |
| Stripe, Paystack and Flutterwave do not serve PNG | No online payment collection — already the chosen scope |
| Currency is **PGK**, written `K1,200.00` | Single-currency in v1, but store minor units as integers |
| Timezone `Pacific/Port_Moresby`, UTC+10, no DST | Schedule in landlord local time, persist UTC |
| Data is expensive; connections are slow | PDFs under ~150 KB, lightweight approval page, plain-text email fallback |
| Nearest major cloud region is Sydney (`ap-southeast-2`) | Host there |

**The retrofit trap:** add `property.use_type` (residential \| commercial) and
`org.gst_registered` / `org.gst_number` on day one even if your mother's
portfolio is entirely residential. Adding GST to an invoicing system that has
already issued invoices is genuinely painful; adding it now is one checkbox.

## 5. Scope

**In v1**

- Signup, one organisation per user
- Properties → units → tenants → tenancies
- Recurring monthly charge per tenancy, with start date and optional annual escalation
- 2–3 clean invoice templates, logo upload, organisation details, bank details
- Draft → landlord approval → scheduled send to tenants
- PDF generation and email delivery with attachment
- Mark as paid; simple arrears view
- Sequential invoice numbering per organisation

**Deliberately out of v1**

| Excluded | Why |
|---|---|
| Online payment collection | No viable PNG rail for a small operator |
| Staff / multi-user accounts | The audience is one person |
| AI logo generation | See recommendation 2 — solves a five-minute, one-time problem |
| Lease documents, maintenance requests | Different product |
| Accounting exports beyond CSV | The road to becoming Xero, badly |
| Multi-currency | Until there's a second country |
| Subscription billing | Invoice your first 20 customers by hand |

## 6. Architecture

**Recommendation: one boring Django monolith.**

- PDF generation is a first-class requirement, and Python's ReportLab /
  WeasyPrint are more mature than the JS equivalents. The `.venv` in this repo
  already has `reportlab`, `jinja2` and `pillow` — you'd started down this path.
- Django admin gives you a free back-office for supporting users in year one.
- Scheduled jobs are the heart of the product; Django plus a cron worker is
  about as simple as this gets.
- One language, one process, one deploy, one person can operate it.

*The case against:* Next.js would give a slightly better mobile-web feel, cheaper
hosting, and a larger hiring pool. But PDF rendering, cron, and an admin panel
are exactly the three things Django hands you free and JavaScript makes you
assemble. **This choice is cheap to reverse now and expensive later — say the
word if you'd rather TypeScript.**

```
 ┌─────────────────────────────────────────┐
 │  Django monolith  (Fly.io / Railway,    │
 │                    Sydney region)       │
 │  ├── web         landlord UI + approval │
 │  ├── admin       your support console   │
 │  └── worker      hourly billing run     │
 └───────┬─────────────────────┬───────────┘
         │                     │
    ┌────▼─────┐       ┌───────▼────────┐
    │ Postgres │       │ Object storage │  frozen PDFs, logos
    └──────────┘       └────────────────┘
         │
    ┌────▼──────────────────────┐
    │ Email  (Resend / Postmark)│  dedicated sending domain
    └───────────────────────────┘
```

## 7. Data model — the parts that matter

```
Org         name, address, logo, bank_details, gst_registered,
            gst_number, invoice_prefix, next_invoice_number, timezone
Property    org, address, use_type (residential | commercial)
Unit        property, label            # a standalone house is one unit
Tenant      org, name, email, phone
Tenancy     unit, tenant, start_date, end_date?, rent_amount,
            billing_day, escalation?
BillingRun  org, period (2026-10), status, approval_token, send_at
Invoice     billing_run, tenancy, number, issue_date, due_date,
            subtotal, gst_amount, total, status, pdf_key, sent_at, paid_at
InvoiceLine invoice, description, quantity, unit_amount, gst_applicable
EmailEvent  invoice, type, provider_message_id, status
```

**Invariants worth enforcing in the database, not just in code:**

- `unique(tenancy, period)` — the idempotency key that makes it safe to run the
  scheduler every hour. A duplicated rent invoice is a trust-destroying bug.
- Invoice numbers are allocated **at approval**, not at draft, so abandoned
  drafts don't punch gaps in your sequence.
- The PDF is rendered **once**, at approval, and frozen in object storage. Never
  re-render from live data: the tenant's copy and your copy must match forever,
  including after a rent increase.
- Money is stored as integer toea (minor units). Never floats.

## 8. The scheduling engine

A single idempotent `run_billing` command, executed hourly:

1. Active tenancy due within the lead time and no `BillingRun` for that period
   → create draft invoices, grouped into one run per organisation.
2. Run in `draft` → send the approval digest, move to `awaiting_approval`.
3. Run `approved` and `send_at <= now` → send tenant emails, move to `sent`.
4. Run still `awaiting_approval` at `send_at` → **hold**, and tell the landlord
   it was held.
5. Overdue invoices past the reminder threshold → reminder.

Every step must be safe to run twice. Design it so that the worst outcome of a
crashed, retried, or double-scheduled run is *nothing happens*, never *a tenant
gets billed twice*.

## 9. Business model

Candid: PNG's small-landlord market is small and price-sensitive. Price for
"cheaper than the hassle", not for SaaS benchmarks.

- **Free** for 1–2 tenancies. Your mother is user #1 and stays free forever.
- **~K25–50/month** for up to 10 tenancies.
- **~K100/month** for up to 30.
- Push annual payment. Recurring card billing is awkward in PNG — invoice your
  own customers annually by bank transfer and dogfood the product.
- Build no subscription billing in v1. Invoice your first 20 customers by hand.

## 10. Recommendations

1. **Build for your mother first, launch to strangers second.** Run her whole
   portfolio through it for three months before signup opens. You will discover
   the real problems — tenant moved out mid-month, part payment, a month waived,
   rent paid in kind — at zero reputational cost.
2. **Skip AI logo generation in v1.** Nano Banana is Google's Gemini image model
   and it is genuinely good, but a landlord needs a logo *once*, for five
   minutes. Offer logo upload plus an auto-generated monogram (initials in a
   coloured circle) and you cover ~95% of cases for zero cost and zero external
   AI dependency. Revisit only if users actually ask.
3. **Treat email deliverability as your top technical risk.** Dedicated sending
   domain, SPF + DKIM + DMARC, warm it slowly, monitor bounces from day one. An
   invoice sitting silently in a spam folder is worse than no invoice, because
   everyone believes it was sent.
4. **Never let silence mean send.** Restating it because it's the one rule that,
   if broken, ends the product.
5. **Keep a manual override on everything.** Real tenancies are messy. If the
   software can't express the mess, users go back to Word.
6. **Phone-first, one-handed.** The approval screen is the most-used screen in
   the product. It should work on a mid-range Android on a bad connection.
7. **Don't build the accounting.** Export CSV and stop.
8. **Design it to generalise, but don't build for it.** Keep the money and tax
   rules behind one adapter so Fiji, Solomon Islands or Vanuatu is a config file
   rather than a rewrite — then ignore them until PNG works.

## 11. Roadmap

| Phase | Duration | Outcome |
|---|---|---|
| 0 | ~1 week | PDF generator + template, run by hand for your mother. Value on day one, no accounts needed. |
| 1 | 3–4 weeks | Accounts, properties, tenants, tenancies, "generate invoice now" |
| 2 | 2–3 weeks | Scheduler + approval loop + tenant delivery — **this is the product** |
| 3 | ~2 weeks | Payment tracking, arrears, reminders |
| 4 | — | Open signup, pricing, support |

## 12. Risks

| Risk | Mitigation |
|---|---|
| Email lands in spam | Dedicated domain, full auth records, bounce monitoring, visible "sent/delivered" state in the UI |
| Duplicate or wrong invoice | Database-level idempotency key; frozen PDFs; every send logged |
| Landlord stops approving | Held-batch notification, then a nudge; never auto-send |
| PNG market too small | Adapter-shaped money/tax layer so a second country is config, not a rewrite |
| You are generating tax documents | Clear disclaimer: this is a tool, not an accountant |

## 13. Open questions

1. **Stack** — Django recommended above; happy to switch to TypeScript if you
   prefer. Cheap to change now.
2. **Residential, commercial, or both?** Decides whether GST appears in v1 at all.
3. **Fixed or variable monthly amount?** Do utilities, water or levies get added
   per month, or is it one flat rent figure?
4. **Is there an existing invoice format** you or your mother already use that
   the templates should match?

---

### Sources for the PNG tax findings

- [PwC Tax Summaries — Papua New Guinea, Other taxes](https://taxsummaries.pwc.com/papua-new-guinea/corporate/other-taxes)
- [Internal Revenue Commission — Goods & Services Tax](https://irc.gov.pg/tax-information/goods-services-tax/)
- [Business Advantage PNG — GST in Papua New Guinea](https://www.businessadvantagepng.com/goods-and-services-tax-gst-in-papua-new-guinea/)
