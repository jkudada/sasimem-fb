/**
 * Judging the sending domain's DNS for Resend (plan §6.6, risk "email lands in spam").
 * Resend sends from a subdomain `send.` (SPF and a bounce MX for Amazon SES), signs with
 * the key at `resend._domainkey.`, and DMARC sits at `_dmarc.` here or on the parent.
 */
export interface DnsAnswers {
  txt: Record<string, string[][]>; // as node:dns resolveTxt returns: each record in chunks
  mx: Record<string, { exchange: string; priority: number }[]>;
}
export type Finding = { record: "SPF" | "MX" | "DKIM" | "DMARC"; name: string; ok: true } | { record: "SPF" | "MX" | "DKIM" | "DMARC"; name: string; ok: false; problem: string };

const texts = (a: DnsAnswers, name: string) => (a.txt[name] ?? []).map((chunks) => chunks.join(""));
const ok = (record: Finding["record"], name: string): Finding => ({ record, name, ok: true });
const bad = (record: Finding["record"], name: string, problem: string): Finding => ({ record, name, ok: false, problem });

function spf(a: DnsAnswers, name: string): Finding {
  const records = texts(a, name).filter((t) => /^v=spf1(\s|$)/i.test(t));
  if (records.length === 0) return bad("SPF", name, "no SPF record");
  if (records.length > 1) return bad("SPF", name, `${records.length} SPF records; there must be exactly one`);
  return /\binclude:amazonses\.com\b/i.test(records[0] ?? "") ? ok("SPF", name) : bad("SPF", name, "does not include amazonses.com, which Resend sends through");
}

function mx(a: DnsAnswers, name: string): Finding {
  return (a.mx[name] ?? []).some((r) => /\.amazonses\.com\.?$/i.test(r.exchange)) ? ok("MX", name) : bad("MX", name, "no MX record for bounces");
}

function dkim(a: DnsAnswers, name: string): Finding {
  return texts(a, name).some((t) => /(^|;\s*)p=[A-Za-z0-9+/=]{20,}/.test(t)) ? ok("DKIM", name) : bad("DKIM", name, "no DKIM key");
}

function dmarc(a: DnsAnswers, domain: string): Finding {
  const parent = domain.split(".").length > 2 ? domain.slice(domain.indexOf(".") + 1) : null;
  const names = [`_dmarc.${domain}`, ...(parent === null ? [] : [`_dmarc.${parent}`])];
  for (const name of names) {
    const record = texts(a, name).find((t) => /^v=DMARC1/i.test(t));
    if (record === undefined) continue;
    return /(^|;)\s*p=(none|quarantine|reject)\s*(;|$)/i.test(record) ? ok("DMARC", name) : bad("DMARC", name, "no policy (p=none, quarantine or reject)");
  }
  return bad("DMARC", names[0] ?? "", `no DMARC record here${names[1] === undefined ? "" : ` or at ${names[1]}`}`);
}

export function judgeMailDns(domain: string, a: DnsAnswers): Finding[] {
  const send = `send.${domain}`;
  return [spf(a, send), mx(a, send), dkim(a, `resend._domainkey.${domain}`), dmarc(a, domain)];
}
