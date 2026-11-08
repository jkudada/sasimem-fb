import type { Mail, Mailer } from "../../src/mail/mailer.js";

/** The in-memory mailer (plan §9.1): fakes cross the network boundary, nothing else does. */
export class FakeMailer implements Mailer {
  readonly sent: Mail[] = [];
  /** Set to refuse every message, as Resend does with a bad key. */
  refusing = false;
  async send(mail: Mail): Promise<{ id: string }> {
    if (this.refusing) throw new Error("Resend refused the message (401): API key is invalid");
    this.sent.push(mail);
    return { id: `fake-${this.sent.length}` };
  }
  to(address: string): Mail[] {
    return this.sent.filter((m) => m.to === address);
  }
}

/**
 * Tokens in sequence, so a test knows the link it should find: next() gives the next
 * one, nth(n) names the n-th. A random prefix keeps tests in one worker apart.
 */
export function tokens() {
  const prefix = crypto.randomUUID().replaceAll("-", "");
  let n = 0;
  const nth = (i: number) => `${prefix}tok${i}`;
  return { next: () => nth(++n), nth };
}
