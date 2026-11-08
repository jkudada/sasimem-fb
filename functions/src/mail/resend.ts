/**
 * The Resend adapter (plan §6.6, A6): one POST per message, plain text, the PDF as a
 * base64 attachment. The sender is MAIL_FROM on the sending domain, with the
 * landlord's name as its display name; replies go to the landlord.
 */
import type { Mail, Mailer } from "./mailer.js";

export interface ResendConfig {
  readonly apiKey: () => string;
  /** The bare sending address, e.g. invoices@mail.sasimem.example. */
  readonly from: () => string;
  readonly fetch?: typeof globalThis.fetch;
}

/** A display name with nothing that could close the quoted name or start a header. */
const displayName = (name: string): string => name.replace(/[\r\n]+/g, " ").replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim();

export class ResendMailer implements Mailer {
  constructor(private readonly config: ResendConfig) {}

  async send(mail: Mail): Promise<{ id: string }> {
    const name = displayName(mail.fromName ?? "");
    const body = {
      from: name === "" ? this.config.from() : `${name} <${this.config.from()}>`,
      to: [mail.to],
      ...(mail.replyTo === undefined ? {} : { reply_to: mail.replyTo }),
      subject: mail.subject,
      text: mail.text,
      ...(mail.attachments === undefined ? {} : { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) }),
    };
    const res = await (this.config.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey()}`,
        "Content-Type": "application/json",
        ...(mail.idempotencyKey === undefined ? {} : { "Idempotency-Key": mail.idempotencyKey }),
      },
      body: JSON.stringify(body),
    });
    const reply = (await res.json().catch(() => ({}))) as { id?: unknown; message?: unknown };
    if (!res.ok || typeof reply.id !== "string") {
      throw new Error(`Resend refused the message (${res.status}): ${typeof reply.message === "string" ? reply.message : res.statusText}`);
    }
    return { id: reply.id };
  }
}
