/**
 * Check a sending domain's DNS for Resend: SPF and the bounce MX on send.<domain>, the
 * DKIM key at resend._domainkey.<domain>, and DMARC (docs/runbooks/sending-domain.md).
 *
 *   node ops/mail-dns.ts --domain mail.example.com
 *
 * Exits 1 if any record is missing or wrong.
 */
import { resolveMx, resolveTxt } from "node:dns/promises";
import { type DnsAnswers, judgeMailDns } from "./src/maildns.ts";
import { fail } from "./src/gcp.ts";
import { flag } from "./src/guard.ts";

const quietly = async <T>(lookup: Promise<T>, none: T): Promise<T> => lookup.catch(() => none);

async function main() {
  const domain = flag(process.argv.slice(2), "domain");
  if (domain === undefined || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("Name the sending domain: --domain mail.example.com");
  const parent = domain.slice(domain.indexOf(".") + 1);
  const names = [`send.${domain}`, `resend._domainkey.${domain}`, `_dmarc.${domain}`, `_dmarc.${parent}`];
  const answers: DnsAnswers = { txt: {}, mx: { [`send.${domain}`]: await quietly(resolveMx(`send.${domain}`), []) } };
  for (const name of names) answers.txt[name] = await quietly(resolveTxt(name), []);

  const findings = judgeMailDns(domain, answers);
  for (const f of findings) console.log(`${f.ok ? "ok  " : "FAIL"}  ${f.record.padEnd(5)} ${f.name}${f.ok ? "" : `: ${f.problem}`}`);
  if (findings.some((f) => !f.ok)) process.exit(1);
}

main().catch(fail);
