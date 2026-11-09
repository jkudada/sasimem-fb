/**
 * The Gmail adapter, for the testing phase: Gmail's SMTP with an app password. Mail
 * goes out as the Gmail account itself, under the landlord's name; replies go to the
 * landlord. Gmail has no idempotency key, and allows about 500 messages a day.
 * Production sends through Resend (resend.ts) from a verified domain.
 */
import { createTransport, type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { Mail, Mailer } from "./mailer.js";

/** The part of a nodemailer transport this adapter uses. */
export interface SmtpTransport {
  sendMail(message: SendMailOptions): Promise<{ messageId: string }>;
}

export interface GmailConfig {
  /** The Gmail address the app password belongs to. */
  readonly user: () => string;
  readonly appPassword: () => string;
  readonly transport?: (options: SMTPTransport.Options) => SmtpTransport;
}

/** A display name with nothing that could close the quoted name or start a header. */
const displayName = (name: string): string => name.replace(/[\r\n]+/g, " ").replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim();

export class GmailMailer implements Mailer {
  private connection: SmtpTransport | undefined;
  constructor(private readonly config: GmailConfig) {}

  /** Made on first use, when the secret can be read, then reused by a warm instance. */
  private smtp(): SmtpTransport {
    const make = this.config.transport ?? ((options: SMTPTransport.Options) => createTransport(options));
    this.connection ??= make({
      host: "smtp.gmail.com", port: 465, secure: true,
      // Google shows an app password in groups of four; the spaces are not part of it.
      auth: { user: this.config.user(), pass: this.config.appPassword().replace(/\s+/g, "") },
    });
    return this.connection;
  }

  async send(mail: Mail): Promise<{ id: string }> {
    const name = displayName(mail.fromName ?? "");
    const message: SendMailOptions = {
      from: name === "" ? this.config.user() : { name, address: this.config.user() },
      to: mail.to,
      ...(mail.replyTo === undefined ? {} : { replyTo: mail.replyTo }),
      subject: mail.subject,
      text: mail.text,
      ...(mail.html === undefined ? {} : { html: mail.html }),
      // An inline image (the logo) carries its content ID, which the HTML shows as cid:{id}.
      ...(mail.attachments === undefined ? {} : {
        attachments: mail.attachments.map((a) => ({
          filename: a.filename, content: a.content,
          ...(a.contentId === undefined ? {} : { cid: a.contentId }),
          ...(a.contentType === undefined ? {} : { contentType: a.contentType }),
        })),
      }),
    };
    try {
      const sent = await this.smtp().sendMail(message);
      return { id: sent.messageId };
    } catch (e) {
      const err = e as { message?: string; code?: string; responseCode?: number; response?: string };
      if (typeof err.responseCode === "number") throw new Error(`Gmail refused the message (${err.responseCode}): ${err.response ?? err.message ?? ""}`);
      throw new Error(`Gmail could not be reached (${err.code ?? "unknown"}): ${err.message ?? String(e)}`);
    }
  }
}
