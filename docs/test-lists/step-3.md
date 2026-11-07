# Step 3 test list: setup screens (properties, tenants, tenancies, charges, settings)

Written before the code (plan §9.1). Ticked as each goes red → green.

Decisions this list assumes (the user chose the defaults on 2026-11-07):
- no rent escalation; one invoice layout; signup allow-list still open (plan §13.4).
- Reads use Firestore Lite, fetched when a screen opens. The full SDK's offline
  cache (plan §7) costs ~130 KB gzip and would break the 160 KB shell budget, so
  it stays out; the screens say plainly when they need a connection.
- Logos go straight to Storage from the browser (plan §5: owners, image/*, ≤ 200 KB).
  Downscaling to ≤ 400 px belongs with the PDF in step 4.
- Rules cannot query, so "this tenant or unit still has a tenancy" is checked by
  core and enforced in the UI. The trigger never breaks a tenancy if one slips through:
  drafting reads the tenancy's own copies.
- Settings does not offer the timezone: v1 is PNG only.
- A property has at most 20 units (step 2 allowed 50), so the rules can check each
  unit by index, as they do charges.
- The Storage emulator answers `firestore.get()` from the project it was started
  with, so Storage rules tests run in `demo-sasimem`, kept apart by random org IDs.

## core (T1)
- [x] chargeProblems: a description is required, ≤ 100 chars
- [x] chargeProblems: the amount may be negative (a credit) but within ±K10,000,000.00, and not zero
- [x] chargeProblems: a one-off charge needs a real month; a monthly charge has none
- [x] chargesProblem: at most 10 additional charges
- [x] profileProblems: the org rules without the first invoice number (orgProblems reuses it)
- [x] tenancyCopies: a tenancy's copies follow its tenant's name and its property's address, use and unit label
- [x] tenancyCopies: a unit that no longer exists keeps the tenancy's last label
- [x] tenancyState: upcoming before the start, current while active, ended after the end date
- [x] unitRemovalProblem: a unit with a tenancy cannot be removed from its property
- [x] deleteProblem: a tenant or property with a tenancy cannot be deleted
- [x] sameAsRentLabel: "same as the rent" says which way it falls for this property (taxable or not)

## Security rules (T2)
- [x] an owner can edit a property and a tenant; a stranger cannot
- [x] an edited property or tenant is still validated (use type, units, email)
- [x] an owner can delete a property and a tenant; a stranger cannot
- [x] a tenancy can be ended (endDate) and its charges edited; not with a float charge
- [x] the org profile accepts a logoPath under its own logos/ folder, and nothing else
- [x] storage: an owner can upload a logo image ≤ 200 KB to logos/{orgId}/; a member can read it
- [x] storage: a stranger can neither read nor write it; a non-image or a file over 200 KB is refused
- [x] storage: nothing else in the bucket is readable or writable (PDFs are server only)

## Functions (T3, real emulators)
- [ ] syncTenancyCopies: renaming a tenant updates every tenancy that names them, in this org only
- [ ] syncTenancyCopies: a property's new address, use or unit label reaches its tenancies
- [ ] syncTenancyCopies: an update that changes no copied field writes nothing
- [ ] setNextInvoiceNumber: an owner sets where numbering starts; it is stored as a whole number
- [ ] setNextInvoiceNumber: refused once any invoice number has been issued
- [ ] setNextInvoiceNumber: refused for a non-member and for a number below 1
- [ ] the trigger and the callable run in australia-southeast1 (region test covers them)

## Web (T1 components)
- [ ] home: links to properties, tenants and settings; sign out
- [ ] properties: lists each address with its units
- [ ] property form: edits address, use and units; core's problems shown; a unit with a tenancy cannot be removed
- [ ] tenants: lists each name and email; a tenant with a tenancy cannot be deleted
- [ ] tenant form: core's problems shown; saves name, email, phone
- [ ] tenancy form: picks a property, unit and tenant; terms parsed as in onboarding
- [ ] tenancy form: adds, edits, pauses and removes charges; amounts parsed from kina; credits allowed
- [ ] tenancy form: GST treatment reads "same as the rent" and says what that means here
- [ ] tenancy: ending sets the end date; delete is offered only when it was never invoiced
- [ ] tenancies are listed under their property as upcoming, current or ended
- [ ] settings: edits letterhead, bank, GST and timing with core's problems; saves the profile
- [ ] settings: a logo over 200 KB or not an image is refused before upload
- [ ] settings: next invoice number shows a plain message once numbering has started
- [ ] routing: signed-in routes for each screen; an unknown path goes home

## Size budgets
- [ ] sign-in route still ≤ 70 KB gzip; signed-in shell ≤ 160 KB gzip with the new screens and Storage
