import { parsePeriod } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { sendLogged } from "../src/mail/log.js";
import type { Mail, Mailer } from "../src/mail/mailer.js";
import { adminDb, randomOrgId } from "./harness/index.js";
import { FakeMailer } from "./harness/mailer.js";

const now = new Date("2026-09-30T22:00:00Z");
const mail: Mail = { to: "peter@kila.example", subject: "Invoice INV-0001 from Wari Holdings", text: "https://secret.example/a/token-in-the-body" };
const logOf = async (orgId: string) => (await adminDb().collection(`orgs/${orgId}/emails`).get()).docs.map((d) => d.data());

describe("the email log (plan §6.6)", () => {
  test("a sent message is logged with its kind, recipient, subject, run, invoice, provider ID and time - and no body", async () => {
    const orgId = randomOrgId();
    const mailer = new FakeMailer();
    await sendLogged({ mailer, now }, { orgId, kind: "tenantInvoice", runPeriod: parsePeriod("2026-10"), invoiceId: "k1_2026-10" }, mail);
    expect(mailer.sent).toHaveLength(1);
    expect(await logOf(orgId)).toEqual([{
      kind: "tenantInvoice", to: "peter@kila.example", subject: "Invoice INV-0001 from Wari Holdings",
      runPeriod: "2026-10", invoiceId: "k1_2026-10", providerMessageId: "fake-1", sentAt: Timestamp.fromDate(now), status: "sent", error: null,
    }]);
  });

  test("a message sent only once gets an idempotency key; a fresh link, which may be asked for again, does not", async () => {
    const orgId = randomOrgId();
    const mailer = new FakeMailer();
    await sendLogged({ mailer, now }, { orgId, kind: "tenantInvoice", runPeriod: parsePeriod("2026-10"), invoiceId: "k1_2026-10" }, mail);
    await sendLogged({ mailer, now }, { orgId, kind: "freshLink", runPeriod: parsePeriod("2026-10") }, mail);
    expect(mailer.sent.map((m) => m.idempotencyKey)).toEqual([`${orgId}/tenantInvoice/k1_2026-10`, undefined]);
  });

  test("a failed send is logged as failed with the reason, and the error is passed on", async () => {
    const orgId = randomOrgId();
    const broken: Mailer = { send: async () => { throw new Error("Resend refused the message (422): Invalid `to` field."); } };
    await expect(sendLogged({ mailer: broken, now }, { orgId, kind: "reminder", runPeriod: parsePeriod("2026-10"), invoiceId: "k1_2026-10" }, mail)).rejects.toThrow("Invalid `to` field.");
    expect(await logOf(orgId)).toMatchObject([{ kind: "reminder", status: "failed", providerMessageId: null, error: "Resend refused the message (422): Invalid `to` field." }]);
  });
});
