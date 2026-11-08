import { describe, expect, test } from "vitest";
import type { SendMailOptions } from "nodemailer";
import { GmailMailer, type SmtpTransport } from "../src/mail/gmail.js";

/** A fake SMTP transport: records the options it was made with and each message. */
function fakeTransport(reply: () => Promise<{ messageId: string }>) {
  const made: unknown[] = [];
  const sent: SendMailOptions[] = [];
  const transport = (options: unknown): SmtpTransport => {
    made.push(options);
    return { sendMail: async (m: SendMailOptions) => { sent.push(m); return reply(); } };
  };
  return { made, sent, transport };
}

/** An error shaped like nodemailer's. */
const smtpError = (fields: { message: string; code?: string; responseCode?: number; response?: string }) => Object.assign(new Error(fields.message), fields);

const mail = {
  to: "peter@kila.example", fromName: "Wari Holdings", replyTo: "mary@wari.example",
  subject: "Invoice INV-0001", text: "Hello Peter",
  attachments: [{ filename: "INV-0001.pdf", content: Buffer.from("%PDF-1.3 tiny") }],
  idempotencyKey: "org-1/tenantInvoice/k1_2026-10",
};

const config = (t: ReturnType<typeof fakeTransport>, password = "abcd efgh ijkl mnop") =>
  ({ user: () => "landlord@gmail.com", appPassword: () => password, transport: t.transport });

describe("the Gmail adapter (testing phase)", () => {
  test("sends over Gmail's SMTP as the account, with the landlord's name, reply-to, text and PDF", async () => {
    const t = fakeTransport(async () => ({ messageId: "<abc@gmail.com>" }));
    expect(await new GmailMailer(config(t)).send(mail)).toEqual({ id: "<abc@gmail.com>" });
    // Google shows an app password in groups of four; the spaces are not part of it.
    expect(t.made).toEqual([{ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: "landlord@gmail.com", pass: "abcdefghijklmnop" } }]);
    expect(t.sent).toEqual([{
      from: { name: "Wari Holdings", address: "landlord@gmail.com" }, to: "peter@kila.example", replyTo: "mary@wari.example",
      subject: "Invoice INV-0001", text: "Hello Peter",
      attachments: [{ filename: "INV-0001.pdf", content: Buffer.from("%PDF-1.3 tiny") }],
    }]);
  });

  test("sends the HTML part and the logo inline by its content ID (docs/PLAN-TEMPLATES.md §6)", async () => {
    const t = fakeTransport(async () => ({ messageId: "<def@gmail.com>" }));
    const logo = Buffer.from("\x89PNG tiny");
    await new GmailMailer(config(t)).send({
      ...mail, html: "<p>Hello Peter</p><img src=\"cid:logo\">",
      attachments: [...mail.attachments, { filename: "logo.png", content: logo, contentId: "logo", contentType: "image/png" }],
    });
    expect(t.sent[0]).toMatchObject({ text: "Hello Peter", html: "<p>Hello Peter</p><img src=\"cid:logo\">" });
    expect(t.sent[0]?.attachments).toEqual([
      { filename: "INV-0001.pdf", content: Buffer.from("%PDF-1.3 tiny") },
      { filename: "logo.png", content: logo, cid: "logo", contentType: "image/png" },
    ]);
  });

  test("a display name cannot break the From header, and no name sends as the bare account", async () => {
    const t = fakeTransport(async () => ({ messageId: "m" }));
    const gmail = new GmailMailer(config(t));
    await gmail.send({ ...mail, fromName: 'Wari "Best" <Holdings>\r\nBcc: x' });
    await gmail.send({ to: "p@x.example", subject: "s", text: "t" });
    expect(t.sent[0]?.from).toEqual({ name: "Wari Best Holdings Bcc: x", address: "landlord@gmail.com" });
    expect(t.sent[1]).toEqual({ from: "landlord@gmail.com", to: "p@x.example", subject: "s", text: "t" });
  });

  test("the connection is made once and reused", async () => {
    const t = fakeTransport(async () => ({ messageId: "m" }));
    const gmail = new GmailMailer(config(t));
    await gmail.send(mail);
    await gmail.send(mail);
    expect(t.made).toHaveLength(1);
    expect(t.sent).toHaveLength(2);
  });

  test("a refusal from Gmail is an error naming its SMTP code and reply", async () => {
    const t = fakeTransport(async () => { throw smtpError({ message: "Invalid login", code: "EAUTH", responseCode: 535, response: "535-5.7.8 Username and Password not accepted." }); });
    await expect(new GmailMailer(config(t)).send(mail)).rejects.toThrow("Gmail refused the message (535): 535-5.7.8 Username and Password not accepted.");
  });

  test("no reply at all is an error saying Gmail could not be reached", async () => {
    const t = fakeTransport(async () => { throw smtpError({ message: "Connection timeout", code: "ETIMEDOUT" }); });
    await expect(new GmailMailer(config(t)).send(mail)).rejects.toThrow("Gmail could not be reached (ETIMEDOUT): Connection timeout");
  });
});
