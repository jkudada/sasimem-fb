import { expect, test, vi } from "vitest";
import { OutboxMailer } from "../src/mail/mailer.js";
import { adminDb } from "./harness/index.js";

test("under the emulator, mail also lands in an outbox a journey can read", async () => {
  const box = `_outbox-${crypto.randomUUID()}`;
  await new OutboxMailer(() => adminDb().collection(box)).send({ to: "mary@wari.example", subject: "Hi", text: "https://x/a/tok" });
  const docs = (await adminDb().collection(box).get()).docs.map((d) => d.data());
  expect(docs).toMatchObject([{ to: "mary@wari.example", subject: "Hi", text: "https://x/a/tok" }]);
});

test("the outbox and the console record the HTML and which attachment is the inline logo", async () => {
  const box = `_outbox-${crypto.randomUUID()}`;
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  await new OutboxMailer(() => adminDb().collection(box)).send({
    to: "peter@kila.example", subject: "Invoice", text: "Hello", html: "<p>Hello</p>",
    attachments: [{ filename: "INV-1.pdf", content: Buffer.from("pdf") }, { filename: "logo.png", content: Buffer.from("png!"), contentId: "logo", contentType: "image/png" }],
  });
  const [doc] = (await adminDb().collection(box).get()).docs.map((d) => d.data());
  expect(doc).toMatchObject({ html: "<p>Hello</p>", attachments: [{ filename: "INV-1.pdf", bytes: 3 }, { filename: "logo.png", bytes: 4, contentId: "logo" }] });
  expect(log.mock.calls[0]?.[0]).toMatch(/\[logo\.png, 4 bytes, inline as cid:logo\] \[HTML, 12 bytes\]/);
  log.mockRestore();
});
