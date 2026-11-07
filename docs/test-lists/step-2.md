# Step 2 test list: data model, rules, createOrg, auth, onboarding

All items done. Added along the way: rules allow a property, tenant and tenancy
in one batch (getAfter); core's newTenancyDocument and withOrgDefaults; a
region test (every function in australia-southeast1) that started as a bug.

Written before the code (plan §9.1). Ticked as each goes red → green.

Decisions this list assumes (from the step-1 report, not contradicted):
- no sign-up allow-list; no rent escalation; one invoice layout;
- rules check membership with `exists(/orgs/{org}/members/{uid})`. `createOrg` still
  sets the `orgIds` custom claim as plan §6.2 says, but nothing depends on it.

Limits the plan leaves open, chosen here and enforced in both `core` and the rules
(say if any is wrong): names ≤ 100 chars, addresses ≤ 200, invoice prefix ≤ 10,
reference code 1-12 letters/digits, due days 0-90, send hour 0-23,
approval lead days 1-28, reminder days 0-60, first invoice number ≥ 1.

## core - setup validation (`setup.ts`), T1
- [x] orgProblems: a name is required; ≤ 100 chars
- [x] orgProblems: the email must look like an email
- [x] orgProblems: a registered org needs a GST number (reuses gstNumberProblem)
- [x] orgProblems: invoice prefix ≤ 10 chars; first invoice number a whole number ≥ 1
- [x] orgProblems: send hour 0-23, lead days 1-28, reminder days 0-60, whole numbers
- [x] orgProblems: a valid org has no problems
- [x] propertyProblems: an address is required; use type residential or commercial
- [x] propertyProblems: at least one unit; unit labels non-blank and unique
- [x] tenantProblems: a name and a valid email are required (invoices are emailed)
- [x] tenancyProblems: billing day a whole number 1-31; due days 0-90
- [x] tenancyProblems: rent ≥ 0 and within the editable maximum
- [x] tenancyProblems: the end date is not before the start date; dates are real dates
- [x] tenancyProblems: reference code 1-12 letters or digits
- [x] parseCalendarDate accepts "2026-10-01" and rejects "2026-02-30", "2026-10-1"

## Security rules (T2) - plan §5 list first
- [x] invariants/I9: an owner cannot write runs, invoices, issuedNumbers, emails, approvalTokens, private/*, members or users
- [x] a stranger cannot read another org, or its tenancies
- [x] a member can read their own org and its tenancies
- [x] nobody reads private/counter, not even the owner; users and approvalTokens are not client-readable
- [x] an owner can create a valid property, tenant and tenancy; a stranger cannot
- [x] a property with an unknown use type is refused
- [x] a tenancy with a float rentToea is refused
- [x] a tenancy with billingDay 0 or 32 is refused
- [x] a tenancy created with invoiced: true is refused
- [x] a tenancy whose denormalised fields do not match its tenant and property is refused
- [x] an owner cannot change `invoiced` or the denormalised fields
- [x] an owner can delete an uninvoiced tenancy, never an invoiced one
- [x] an owner can update the org profile's allowed fields; not createdAt; not GST-registered without a number
- [x] a client cannot create an org (createOrg does that)

## createOrg callable (T3, real emulators)
- [x] creates the org with plan defaults, the owner membership, users/{uid}, and the custom claim
- [x] seeds private/counter from the first invoice number (default 1)
- [x] refuses a caller who is not signed in
- [x] refuses an invalid profile with core's plain-English message, writing nothing
- [x] a second call by the same user returns the same org and creates nothing new
- [x] invariants/I7: no document createOrg writes contains a float

## Web (T1 components; screens stay thin, rules come from core)
- [x] sign in: submits email and password; shows a plain message on failure
- [x] sign up: password of at least 6 characters, else a message
- [x] reset password: always says "check your email", whether or not the account exists
- [x] onboarding, org step: GST number required only when registered, using core's message
- [x] onboarding, org step: first invoice number defaults to 1, explained in plain words
- [x] onboarding, first tenancy step: rent typed as kina is parsed by parseKina; amount problems shown
- [x] onboarding, first tenancy step: submits property, tenant and tenancy built by core
- [x] routing: signed out → sign in; signed in without an org → onboarding; with an org → home

## Size budgets
- [x] sign-in route ≤ 70 KB gzip with Firebase Auth; signed-in shell ≤ 160 KB gzip

T4 journey 1 ("onboarding to first draft") needs drafting, so it is written in step 4.
The denormalised-field trigger (plan §4) arrives with the edit screens in step 3.
