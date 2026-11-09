import { describe, expect, test } from "vitest";
import { ResendMailer } from "../src/mail/resend.js";

/** A fake fetch: records each request and answers with the given status and body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const mail = {
  to: "peter@kila.example", fromName: "Wari Holdings", replyTo: "mary@wari.example",
  subject: "Invoice INV-0001", text: "Hello Peter",
  attachments: [{ filename: "INV-0001.pdf", content: Buffer.from("%PDF-1.3 tiny") }],
  idempotencyKey: "org-1/tenantInvoice/k1_2026-10",
};

describe("the Resend adapter (plan §6.6)", () => {
  test("posts the message with the key and an idempotency key, the PDF in base64, and returns Resend's ID", async () => {
    const f = fakeFetch(200, { id: "re_123" });
    const mailer = new ResendMailer({ apiKey: () => "re_key", from: () => "invoices@mail.sasimem.example", fetch: f.fetch });
    expect(await mailer.send(mail)).toEqual({ id: "re_123" });
    const [call] = f.calls;
    expect(call?.url).toBe("https://api.resend.com/emails");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toMatchObject({ Authorization: "Bearer re_key", "Content-Type": "application/json", "Idempotency-Key": "org-1/tenantInvoice/k1_2026-10" });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      from: "Wari Holdings <invoices@mail.sasimem.example>", to: ["peter@kila.example"], reply_to: "mary@wari.example",
      subject: "Invoice INV-0001", text: "Hello Peter",
      attachments: [{ filename: "INV-0001.pdf", content: Buffer.from("%PDF-1.3 tiny").toString("base64") }],
    });
  });

  test("sends the HTML part and the logo as an inline attachment with its content ID (docs/PLAN-TEMPLATES.md §6)", async () => {
    const f = fakeFetch(200, { id: "re_2" });
    const logo = Buffer.from("\x89PNG tiny");
    await new ResendMailer({ apiKey: () => "k", from: () => "invoices@x.example", fetch: f.fetch }).send({
      ...mail, html: "<p>Hello Peter</p><img src=\"cid:logo\">",
      attachments: [...mail.attachments, { filename: "logo.png", content: logo, contentId: "logo", contentType: "image/png" }],
    });
    const body = JSON.parse(String(f.calls[0]?.init.body));
    expect(body).toMatchObject({ text: "Hello Peter", html: "<p>Hello Peter</p><img src=\"cid:logo\">" });
    expect(body.attachments).toEqual([
      { filename: "INV-0001.pdf", content: Buffer.from("%PDF-1.3 tiny").toString("base64") },
      { filename: "logo.png", content: logo.toString("base64"), content_id: "logo", content_type: "image/png" },
    ]);
  });

  test("a display name cannot break the From header", async () => {
    const f = fakeFetch(200, { id: "re_1" });
    await new ResendMailer({ apiKey: () => "k", from: () => "invoices@x.example", fetch: f.fetch }).send({ ...mail, fromName: 'Wari "Best" <Holdings>\r\nBcc: x' });
    expect(JSON.parse(String(f.calls[0]?.init.body)).from).toBe("Wari Best Holdings Bcc: x <invoices@x.example>");
  });

  test("a refusal from Resend is an error naming its status and message", async () => {
    const f = fakeFetch(422, { statusCode: 422, name: "validation_error", message: "Invalid `to` field." });
    const mailer = new ResendMailer({ apiKey: () => "k", from: () => "invoices@x.example", fetch: f.fetch });
    await expect(mailer.send(mail)).rejects.toThrow("Resend refused the message (422): Invalid `to` field.");
  });
});
