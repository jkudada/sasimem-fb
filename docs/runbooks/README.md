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

## Before production takes real mail (the owner, on `sasimem-prod`)

1. `firebase apps:create web sasimem-web --project sasimem-prod`, if there is no web app yet.
2. `node ops/app-check.ts --project sasimem-prod --i-am-the-owner --monitor-only [--domain <custom domain>]`.
   Build with the printed `VITE_RECAPTCHA_SITE_KEY`, deploy, then watch App Check's
   metrics in the console for a day or two before running it again without `--monitor-only`.
3. `node ops/alerts.ts --project sasimem-prod --i-am-the-owner --email <your address>`.
4. `node ops/budget.ts --project sasimem-prod --i-am-the-owner --billing-account <id>`, then run the command it prints.
5. Set up the sending domain ([sending-domain.md](sending-domain.md)) until `node ops/mail-dns.ts --domain <domain>` passes;
   set `MAIL_FROM` in `functions/.env.sasimem-prod` and the `RESEND_API_KEY` secret.
6. `node ops/restore-drill.ts --project sasimem-prod --i-am-the-owner` once a backup exists, and record the result in [restore.md](restore.md).
