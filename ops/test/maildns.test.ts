import { describe, expect, test } from "vitest";
import { type DnsAnswers, judgeMailDns } from "../src/maildns.ts";

const D = "mail.sasimem.example";
const good: DnsAnswers = {
  txt: {
    [`send.${D}`]: [["v=spf1 include:amazonses.com ~all"]],
    [`resend._domainkey.${D}`]: [["p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC", "abc"]],
    [`_dmarc.${D}`]: [["v=DMARC1; p=none; rua=mailto:dmarc@sasimem.example"]],
  },
  mx: { [`send.${D}`]: [{ exchange: "feedback-smtp.ap-northeast-1.amazonses.com", priority: 10 }] },
};
const without = (kind: "txt" | "mx", name: string): DnsAnswers => {
  const copy = structuredClone(good);
  return { ...copy, [kind]: Object.fromEntries(Object.entries(copy[kind]).filter(([n]) => n !== name)) };
};
const problems = (a: DnsAnswers) => judgeMailDns(D, a).filter((r) => !r.ok).map((r) => `${r.record}: ${r.problem}`);

describe("the sending domain's DNS (plan §6.6: SPF, DKIM and DMARC before the first real send)", () => {
  test("all four records present and right", () => {
    expect(judgeMailDns(D, good).map((r) => [r.record, r.name, r.ok])).toEqual([
      ["SPF", `send.${D}`, true],
      ["MX", `send.${D}`, true],
      ["DKIM", `resend._domainkey.${D}`, true],
      ["DMARC", `_dmarc.${D}`, true],
    ]);
  });

  test("each missing record is named", () => {
    expect(problems(without("txt", `send.${D}`))).toEqual(["SPF: no SPF record"]);
    expect(problems(without("mx", `send.${D}`))).toEqual(["MX: no MX record for bounces"]);
    expect(problems(without("txt", `resend._domainkey.${D}`))).toEqual(["DKIM: no DKIM key"]);
    expect(problems(without("txt", `_dmarc.${D}`))).toEqual(["DMARC: no DMARC record here or at _dmarc.sasimem.example"]);
  });

  test("SPF: two records is an error (receivers then ignore both); one not naming Amazon SES is wrong", () => {
    const two = structuredClone(good);
    two.txt[`send.${D}`] = [["v=spf1 include:amazonses.com ~all"], ["v=spf1 -all"]];
    expect(problems(two)).toEqual(["SPF: 2 SPF records; there must be exactly one"]);
    const other = structuredClone(good);
    other.txt[`send.${D}`] = [["v=spf1 include:_spf.google.com ~all"]];
    expect(problems(other)).toEqual(["SPF: does not include amazonses.com, which Resend sends through"]);
  });

  test("DMARC: a record with no policy is wrong; the parent domain's record counts", () => {
    const noPolicy = structuredClone(good);
    noPolicy.txt[`_dmarc.${D}`] = [["v=DMARC1; rua=mailto:x@sasimem.example"]];
    expect(problems(noPolicy)).toEqual(["DMARC: no policy (p=none, quarantine or reject)"]);
    const parent = without("txt", `_dmarc.${D}`);
    parent.txt["_dmarc.sasimem.example"] = [["v=DMARC1; p=quarantine"]];
    expect(judgeMailDns(D, parent).find((r) => r.record === "DMARC")).toEqual({ record: "DMARC", name: "_dmarc.sasimem.example", ok: true });
  });
});
