/**
 * Email (plan §6.6). The Mailer interface, the console mailer the emulator uses, and
 * the outbox the T4 journeys read; resend.ts and gmail.ts send for real and log.ts records every
 * send. Every message has a plain-text body.
 */
export interface Attachment {
  readonly filename: string;
  readonly content: Buffer;
}

export interface Mail {
  readonly to: string;
  /** The landlord's name, shown as the sender's display name. */
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
  readonly attachments?: readonly Attachment[];
  /** Resend drops a repeat of the same key (for 24 hours); Gmail has no such key. */
  readonly idempotencyKey?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<{ id: string }>;
}

/** Prints each message, so a developer running the emulators can follow a link. */
export class ConsoleMailer implements Mailer {
  private n = 0;
  async send(mail: Mail): Promise<{ id: string }> {
    const files = (mail.attachments ?? []).map((a) => ` [${a.filename}, ${a.content.length} bytes]`).join("");
    console.log(`[mail] to ${mail.to}: ${mail.subject}${files}\n${mail.text}`);
    return { id: `console-${++this.n}` };
  }
}

/**
 * Emulator only: each message also lands in the _outbox collection, so a developer or
 * a T4 journey can follow an approval link. Never used when deployed - links are
 * credentials, and the step-5 emails log keeps no bodies.
 */
export class OutboxMailer implements Mailer {
  private readonly console = new ConsoleMailer();
  constructor(private readonly outbox: () => import("firebase-admin/firestore").CollectionReference) {}
  async send(mail: Mail): Promise<{ id: string }> {
    await this.console.send(mail);
    const { attachments, ...rest } = mail;
    // A journey checks that the PDF went, not its bytes.
    const files = (attachments ?? []).map((a) => ({ filename: a.filename, bytes: a.content.length }));
    const ref = await this.outbox().add({ ...rest, attachments: files, at: new Date() });
    return { id: ref.id };
  }
}
