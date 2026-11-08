import { expect, test } from "vitest";
import { OutboxMailer } from "../src/mail/mailer.js";
import { adminDb } from "./harness/index.js";

test("under the emulator, mail also lands in an outbox a journey can read", async () => {
  const box = `_outbox-${crypto.randomUUID()}`;
  await new OutboxMailer(() => adminDb().collection(box)).send({ to: "mary@wari.example", subject: "Hi", text: "https://x/a/tok" });
  const docs = (await adminDb().collection(box).get()).docs.map((d) => d.data());
  expect(docs).toMatchObject([{ to: "mary@wari.example", subject: "Hi", text: "https://x/a/tok" }]);
});
