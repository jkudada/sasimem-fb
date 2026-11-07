/**
 * Email (plan §6.6). Step 4 has the interface, the console mailer the emulator
 * uses, and the fake tests use; the Resend adapter and the emails log are step 5.
 * Every message has a plain-text body.
 */
export interface Mail {
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<{ id: string }>;
}

/** Prints each message, so a developer running the emulators can follow a link. */
export class ConsoleMailer implements Mailer {
  private n = 0;
  async send(mail: Mail): Promise<{ id: string }> {
    console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return { id: `console-${++this.n}` };
  }
}
