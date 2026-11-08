# Runbooks

Each Firebase project is set up and checked by the scripts in `ops/`. They act on exactly
the project named with `--project`, there is no default, and `sasimem-prod` also needs
`--i-am-the-owner`. They use Application Default Credentials: either
`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at
a key file. Run them from the repository root with Node 22 (`node ops/<script>.ts`).

| Runbook | Script | Done on `sasimem-dev` |
|---|---|---|
| [App Check](app-check.md) | `ops/app-check.ts` | 2026-11-08 |
| [Alerts for the tick](alerts.md) | `ops/alerts.ts` | 2026-11-08, with no email |
| [Budget alert](budget.md) | `ops/budget.ts` (prints a command) | n/a: a billing account |
| [Restore drill](restore.md) | `ops/restore-drill.ts` | 2026-11-08 (see the log there) |
| [Sending domain](sending-domain.md) | `ops/mail-dns.ts` | n/a: needs the real domain |
| [Subscribers](subscribers.md) | `ops/plans.ts`, `ops/backfill-subscriptions.ts`, `ops/grant-operator.ts` | dry runs only, 2026-11-08 |

## The first deploy to a new project (the owner, on `sasimem-prod`)

Learned on `sasimem-dev`'s first deploy (2026-11-08, PR #8). Do these in order: a first
deploy that fails part-way leaves functions that are not public, and is slow to undo.

1. **In the Firebase console:** turn on Authentication with the Email/Password provider, and
   turn on Storage (location `australia-southeast1`). Neither can be done by `firebase deploy`.
   Sasimem is invite-only for now: real builds hide sign-up (`VITE_SIGN_UP=closed` in
   `apps/web/.env.production`), so also untick **Enable create (sign-up)** under Authentication →
   Settings → User actions. Otherwise anyone can still create an account straight through the
   Auth API. Add each landlord yourself under Authentication → Users → **Add user**.
2. **Create all three secrets before deploying any function:**
   ```sh
   openssl rand -base64 32 | firebase functions:secrets:set APPROVAL_SIGNING_KEY --project sasimem-prod --data-file -
   firebase functions:secrets:set RESEND_API_KEY --project sasimem-prod   # paste the Resend key
   printf unused | firebase functions:secrets:set GMAIL_APP_PASSWORD --project sasimem-prod --data-file -
   ```
   Production sends through Resend. Every mail function still declares both senders' secrets,
   because the deploy cannot see `MAIL_PROVIDER`, so the unused one needs a placeholder. Only a
   test project sets `MAIL_PROVIDER=gmail`, and then `RESEND_API_KEY` is the placeholder instead.
   Without a real `RESEND_API_KEY` everything still works except email: "Generate now" says the
   approval email did not go, and the tick's emails fail (each failure is in the org's email log).
3. **Set the parameters** in `functions/.env.sasimem-prod`: `APP_URL` (the Hosting origin, or the
   custom domain) and `MAIL_FROM` (an address on the sending domain: step 5 of the next section).
4. **Grant the service-agent roles** that firebase-tools asks for on a first deploy (in IAM, or
   with the `gcloud projects add-iam-policy-binding` commands it prints):
   - the Pub/Sub service agent (`service-<project number>@gcp-sa-pubsub.iam.gserviceaccount.com`):
     **Service Account Token Creator**;
   - the default compute service account (`<project number>-compute@developer.gserviceaccount.com`):
     **Cloud Run Invoker** and **Eventarc Event Receiver**.
5. **Deploy.** First do steps 1 and 2 of the next section: they give the web app's config and its
   `VITE_RECAPTCHA_SITE_KEY`. Build the web app with those (the variables are in
   `apps/web/.env.example`), then
   ```sh
   firebase deploy --project sasimem-prod
   ```
6. **If the deploy failed part-way,** the callables it created may not be public, and the app's
   calls are then refused before they reach the code. Firebase makes a function public only when it
   creates it, and a callable cannot declare it. Delete the callables (`firebase functions:delete
   <names> --project sasimem-prod --region australia-southeast1`), then deploy again.
   `approvalPage` declares itself public, so a redeploy fixes it.
7. **Smoke test** on the live URL: add a user in the console, sign in as them, create the
   organisation, add a tenancy, "Generate now", approve, open the PDF. Check that `/sign-up` says
   accounts are closed.

## Before production takes real mail (the owner, on `sasimem-prod`)

1. `firebase apps:create web sasimem-web --project sasimem-prod`, if there is no web app yet
   (before the first deploy: its config goes into the web build).
2. `node ops/app-check.ts --project sasimem-prod --i-am-the-owner --monitor-only [--domain <custom domain>]`.
   Build with the printed `VITE_RECAPTCHA_SITE_KEY`, deploy, then watch App Check's
   metrics in the console for a day or two before running it again without `--monitor-only`.
3. `node ops/alerts.ts --project sasimem-prod --i-am-the-owner --email <your address>`.
4. `node ops/budget.ts --project sasimem-prod --i-am-the-owner --billing-account <id>`, then run the command it prints.
5. Set up the sending domain ([sending-domain.md](sending-domain.md)) until `node ops/mail-dns.ts --domain <domain>` passes;
   set `MAIL_FROM` in `functions/.env.sasimem-prod` and the `RESEND_API_KEY` secret. Also create a
   `GMAIL_APP_PASSWORD` secret with any placeholder value (e.g. `unused`): every mail function declares
   it, for dev's Gmail testing, and a deploy fails if a declared secret is missing.
6. `node ops/restore-drill.ts --project sasimem-prod --i-am-the-owner` once a backup exists, and record the result in [restore.md](restore.md).
