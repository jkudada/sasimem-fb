# The sending domain

Mail goes through Resend from `MAIL_FROM` (plan §6.6), with the landlord's name as the display
name and Reply-To set to the landlord. Before the first real send, the sending domain needs
SPF, DKIM and DMARC records, or invoices land in spam.

**Use a subdomain** such as `mail.<your domain>`, so the app's mail reputation is separate from
the domain's other mail. `MAIL_FROM` is then `invoices@mail.<your domain>`.

## Steps (the domain's owner)

1. In Resend → Domains, add `mail.<your domain>` and choose the region nearest Sydney.
2. Resend lists the records to add. They are these (copy Resend's exact values):

   | Type | Name | Value |
   |---|---|---|
   | MX | `send.mail` | `feedback-smtp.<region>.amazonses.com`, priority 10 |
   | TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey.mail` | `p=MIGfMA0…` (the DKIM key) |
   | TXT | `_dmarc` or `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:<an address you read>` |

   The `send.` subdomain carries SPF and bounces. The From address stays `invoices@mail.…`.
   Add only one SPF record on a name: a second makes receivers ignore both.
3. Wait for DNS, then check:

   ```sh
   node ops/mail-dns.ts --domain mail.<your domain>
   ```

   It checks all four and exits 1 if any is missing or wrong. A DMARC record on the parent
   domain counts.
4. Click Verify in Resend.
5. Set `MAIL_FROM=invoices@mail.<your domain>` in `functions/.env.sasimem-prod`. Store the Resend key with
   `firebase functions:secrets:set RESEND_API_KEY --project sasimem-prod`, then deploy.
6. Send yourself a test: approve a month for a test org whose tenant address is yours, and check
   that the headers show `spf=pass`, `dkim=pass` and `dmarc=pass`.
7. After a few weeks of DMARC reports with nothing unexpected, tighten DMARC to `p=quarantine`.

## Status

The real domain is not chosen yet. `functions/.env.demo-sasimem` uses the placeholder
`mail.sasimem.example`, and `sasimem-dev` uses Resend's own `onboarding@resend.dev`, which
only delivers to the Resend account's own address. `ops/mail-dns.ts` passes `resend.dev`
(Resend's domain) and fails the placeholder, as it should.
