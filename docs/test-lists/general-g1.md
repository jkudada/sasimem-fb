# Test list: G1, core generalisation (no visible change)

Written before the code (PLAN-SASIMEM-FB §9.1), from `docs/PLAN-GENERAL-INVOICING.md`
§5 and §8. Ticked as each goes red → green. G1 is built in slices, each its own PR:

| Slice | What | Needs |
|---|---|---|
| **G1a** | `core` only: tax codes, quantities, item lines, invoice sources, modules and features, document counters | - |
| G1b | Customers: the shared customer record, stored at `orgs/{orgId}/tenants` (C1) | - |
| G1c | Functions: new rent invoices carry `source`; golden PDFs unchanged | G1a |

**The G1 rule:** a Rentals user sees nothing new, and every rent invoice, PDF, email and
number is exactly what it would have been before.

## Choices made in G1a (say if any is wrong)

- **No migration for numbering (replaces M2).** `private/counter` keeps `nextInvoiceNumber`
  and gains `nextQuoteNumber`, `nextCreditNoteNumber`, `nextReceiptNumber` when first used.
  A missing field reads as 1. Nothing moves, so the live approval transaction is untouched.
- **No migration for modules (replaces M3).** An org with no `modules` field reads as
  `["rentals"]` with today's features. Existing orgs need no backfill.
- **Quantities are integer thousandths** (1.5 hours = 1500), like money in toea (I7): never
  floats. Three decimal places is enough for metres, litres and hours.
- **Line amount = quantity × unit price, rounded half away from zero to the toea**, the same
  rule as `parseKina`. GST is then worked out on the rounded line amount, per line (today's rule).
- **A negative unit price is allowed** (a discount line); a quantity must be above zero.
- **Zero-rated lines charge no GST.** The title stays "TAX INVOICE" only when a line charges
  GST (today's rule); a fully zero-rated invoice prints "INVOICE". To check with an accountant.
- **With no features stored, features follow the modules:** an org listing `rentals` gets
  today's Rentals features; an org with only other modules gets none until its plan sets them
  (found while building: the first version switched Rentals off for such an org).
- **Rent lines are not changed:** they carry no quantity, unit or tax code, so stored rent
  invoices keep exactly today's fields.

## G1a: core (T1)

### Tax codes
- [x] `standard` charges 10% GST for a registered org; `exempt` and `zero` never do
- [x] an unregistered org charges no GST whatever the code
- [x] an unknown code from stored data is refused, not treated as exempt

### Quantities
- [x] "1", "1.5", "0.25", "2.125" and "1,000" parse to 1000, 1500, 250, 2125 and 1000000
- [x] more than three decimals, a negative, zero, letters and "" are refused with a plain message
- [x] formatting drops trailing zeros: 1500 → "1.5", 1000 → "1", 2125 → "2.125", 1000000 → "1,000"
- [x] parse(format(q)) = q for any valid quantity (property)

### Line amounts
- [x] 1.5 × K80.00 = K120.00; 3 × K0.33 = K0.99; 0.333 × K1.00 = K0.33; 0.335 × K1.00 = K0.34 (half up)
- [x] a negative unit price rounds the magnitude, so a discount mirrors the charge
- [x] exact for the largest quantity and price allowed (no float overflow)
- [x] amount = round(q × p / 1000) for random q, p (property, against BigInt)

### Item lines
- [x] an item line has kind "item", the description, the amount, and its quantity, unit, unit price and tax code
- [x] a standard-rated item for a registered org carries GST on the rounded amount
- [x] problems: empty or > 200-char description, unit over 12 characters, a line amount over K10,000,000
- [x] totals over a mix of rent, extra and item lines add up as before

### Rent unchanged
- [x] a drafted rent invoice's lines carry exactly today's fields: kind, description, detail, amountToea, gstApplicable, gstToea

### Invoice sources
- [x] an invoice with no `source` reads as `{ kind: "rent", tenancyId, period }`
- [x] a stored source is returned as it is
- [x] the source of a new rent draft is `{ kind: "rent", tenancyId, period }`

### Modules and features
- [x] an org with no `modules` reads as `["rentals"]` with features `rentals` and `repeating` only
- [x] stored modules and features are returned; unknown names are dropped, not trusted
- [x] with no features stored, they follow the modules (rentals → today's; others → none)
- [x] `hasFeature` answers from the defaults when nothing is stored

### Document numbers
- [x] each kind has its counter field and default prefix: invoice INV-, quote QUO-, credit note CN-, receipt RCT-
- [x] a missing counter field reads as 1
- [x] the invoice prefix still comes from the org (today's `invoicePrefix`)

## G1b: customers

**C1, agreed 2026-11-19:** a customer is stored where tenants always were,
`orgs/{orgId}/tenants/{id}`, with optional business details. Nothing moves (M1 is dropped);
the path name stays "tenants" internally and can be renamed later. Choices:
- **The Rentals tenant form now saves with a merge**, so editing a tenant's name or phone keeps
  business details it does not show. (Before, the form replaced the whole document.)
- **Copy-to addresses: at most 3**, none repeating the main address. Rules check each by index.
- **Payment terms blank = the org's default.** 0-90 days, as for a tenancy's due days.
- **The CSV export is unchanged** until a screen can set these fields (G2).

### core (T1)
- [x] a tenant as stored today reads as a customer with every extra empty
- [x] stored extras are read back; malformed ones read as empty, not trusted
- [x] name and email follow the tenant rules, in neutral words ("the customer's name")
- [x] copy-to: at most 3, each a real address, none repeating the main one
- [x] lengths: address 200, TIN 20, GST number 20, notes 500, phone 30
- [x] terms blank, or 0-90 whole days
- [x] `CUSTOMER_EXTRAS` names the optional fields, for the rules and store to agree on

### Security rules (T2)
- [x] an owner saves a customer with every business detail, or with none (today's tenant)
- [x] the rules accept exactly the extras core names
- [x] bad details are refused: 4 copy-to addresses, a bad or non-list copy-to, long address or TIN, a number for a GST number, terms 91 / 7.5 / "14", a non-boolean PO flag, long notes, an unknown field
- [x] a merge of name, email and phone onto a customer with details is allowed (the Rentals form)
- [x] a stranger cannot write a customer

## G1c: functions

Choices:
- **No `customerId` on invoices.** With C1 a tenant *is* the customer, so the invoice's existing
  `tenantId` is its customer id; a second field would only be a copy to keep in step.
- **One place makes a new rent invoice.** The tick's drafting and `rebuildRun` each listed the
  fields by hand; both now call `newInvoice`, so they cannot drift apart.
- Invoices drafted before G1c have no `source`; core's `sourceOf` reads them as rent.

### Functions (T3)
- [x] a drafted rent invoice carries `source: { kind: "rent", tenancyId, period }`
- [x] a tenancy added by `rebuildRun` gets the same fields as one drafted by the tick, `source` included
- [x] every existing T3 test passes unchanged: approval, numbering, the golden PDFs (byte-identical), emails, payments, the tick
