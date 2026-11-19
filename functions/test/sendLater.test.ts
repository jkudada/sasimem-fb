/**
 * G2d (docs/test-lists/general-g2.md): a one-off invoice scheduled to send later. Scheduling
 * is the say-so, given ahead (D7); the tick numbers and sends it on the day, through the
 * same transaction as Send. Nothing is numbered until it goes.
 */
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeOneOffCallables } from "../src/callables/oneoff.js";
import { runTick } from "../src/tick.js";
import { newUser, request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { RACE_TIMEOUT_MS } from "./harness/race.js";
import { anOrgWith } from "./harness/seed.js";

const NOW = new Date("2026-11-19T01:00:00Z"); // 11:00 on 19 November in Port Moresby
const TOMORROW = "2026-11-20";
const MOMENT = new Date("2026-11-19T22:00:00Z"); // 8:00 am on 20 November, the org's send hour
const labour = { description: "Labour - rewire kitchen", detail: "", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };

async function world(opts: { feature?: boolean; draft?: Record<string, unknown> } = {}) {
  const { uid, orgId } = await anOrgWith({ tenancies: [] });
  const org = adminDb().doc(`orgs/${orgId}`);
  if (opts.feature !== false) await org.update({ features: { rentals: true, repeating: true, oneOff: true } });
  await org.collection("tenants").doc("c1").set({ name: "Kila Trading", email: "accounts@kila.example", phone: "", ccEmails: ["boss@kila.example"] });
  const draft = org.collection("drafts").doc();
  await draft.set({ customerId: "c1", lines: [labour], poNumber: "", notes: "", dueDays: null, ...opts.draft });

  const mailer = new FakeMailer();
  let now = NOW;
  const deps = { now: () => now, mailer, newToken: tokens().next, appUrl: () => "https://sasimem.example" };
  const c = makeOneOffCallables(deps);
  const draftId = draft.id;
  return {
    uid, orgId, org, draftId, mailer,
    schedule: (sendOn: string, who = uid, id = draftId) => c.scheduleInvoice.run(request(who, { orgId, draftId: id, sendOn })),
    cancel: () => c.cancelSchedule.run(request(uid, { orgId, draftId })),
    send: () => c.issueInvoice.run(request(uid, { orgId, draftId })),
    tick: (at: Date) => { now = at; return runTick(deps, { orgIds: [orgId] }); },
    stored: async () => (await org.collection("sendLater").doc(draftId).get()).data(),
    counter: async () => (await org.collection("private").doc("counter").get()).get("nextInvoiceNumber") as number | undefined,
    invoice: async () => (await org.collection("invoices").doc(draftId).get()).data(),
  };
}

describe("scheduling a draft", () => {
  test("records the day and the moment it goes; nothing is numbered or sent yet, and the draft stays", async () => {
    const w = await world();
    expect(await w.schedule(TOMORROW)).toEqual({
      sendAt: MOMENT.toISOString(),
      message: "Kila Trading's invoice goes on 20 November 2026 at 8:00 am. It is numbered then.",
    });
    expect(await w.stored()).toEqual({
      sendOn: TOMORROW, sendAt: Timestamp.fromDate(MOMENT), customerName: "Kila Trading", scheduledBy: w.uid, scheduledAt: Timestamp.fromDate(NOW),
    });
    expect((await w.org.collection("drafts").doc(w.draftId).get()).exists).toBe(true);
    expect(await w.counter()).toBe(1);
    expect(w.mailer.sent).toEqual([]);
    expect((await w.org.collection("events").where("kind", "==", "invoiceScheduled").get()).docs.map((d) => d.get("note"))).toEqual(["Kila Trading, 20 November 2026 at 8:00 am"]);
  });

  test("scheduling again moves the day; Cancel the schedule drops it and leaves the draft", async () => {
    const w = await world();
    await w.schedule(TOMORROW);
    await w.schedule("2026-12-01");
    expect(await w.stored()).toMatchObject({ sendOn: "2026-12-01", sendAt: Timestamp.fromDate(new Date("2026-11-30T22:00:00Z")) });
    expect(await w.cancel()).toEqual({ message: "It will not be sent. It stays a draft." });
    expect(await w.stored()).toBeUndefined();
    expect((await w.org.collection("drafts").doc(w.draftId).get()).exists).toBe(true);
  });

  test("refused: no one-off invoicing, not the owner, a missing draft", async () => {
    await expect((await world({ feature: false })).schedule(TOMORROW)).rejects.toMatchObject({ code: "failed-precondition" });
    const w = await world();
    await expect(w.schedule(TOMORROW, await newUser())).rejects.toMatchObject({ code: "permission-denied" });
    await expect(w.schedule(TOMORROW, w.uid, "nope")).rejects.toMatchObject({ code: "not-found" });
  });

  test("refused, in core's words: a draft that could not be sent, and a bad day", async () => {
    const bad = await world({ draft: { lines: [] } });
    await expect(bad.schedule(TOMORROW)).rejects.toMatchObject({ code: "invalid-argument", message: "Add at least one line." });
    expect(await bad.stored()).toBeUndefined();
    const w = await world();
    await expect(w.schedule("2026-11-19")).rejects.toMatchObject({ code: "invalid-argument", message: "Choose a day after today. To send it today, press Send invoice." });
    await expect(w.schedule("someday")).rejects.toMatchObject({ code: "invalid-argument", message: "Choose the day to send it." });
    expect(await w.stored()).toBeUndefined();
  });
});

describe("the tick sends it on the day", () => {
  test("not before its moment; then numbered, dated that day, with its PDF, emailed; the draft and the schedule go", async () => {
    const w = await world();
    await w.schedule(TOMORROW);
    expect((await w.tick(new Date(MOMENT.getTime() - 60_000))).scheduled).toBe(0);
    expect(await w.invoice()).toBeUndefined();

    expect((await w.tick(MOMENT)).scheduled).toBe(1);
    expect(await w.invoice()).toMatchObject({
      status: "sent", number: "INV-0001", issueDate: "2026-11-20", dueDate: "2026-12-04", sentAt: Timestamp.fromDate(MOMENT),
      pdfPath: `invoices/${w.orgId}/${w.draftId}.pdf`,
    });
    expect(await w.counter()).toBe(2);
    expect(await w.stored()).toBeUndefined();
    expect((await w.org.collection("drafts").doc(w.draftId).get()).exists).toBe(false);
    expect(w.mailer.sent).toHaveLength(1);
    expect(w.mailer.sent[0]).toMatchObject({ to: "accounts@kila.example", cc: ["boss@kila.example"] });
    expect(w.mailer.sent[0]?.attachments?.[0]?.filename).toBe("INV-0001.pdf");
    const events = await w.org.collection("events").where("kind", "==", "invoiceIssued").get();
    expect(events.docs.map((d) => [d.get("actor"), d.get("note")])).toEqual([[w.uid, "INV-0001, Kila Trading, as scheduled"]]);

    expect((await w.tick(new Date(MOMENT.getTime() + 3_600_000))).scheduled).toBe(0);
    expect(w.mailer.sent).toHaveLength(1);
  });

  test("two ticks at once send it once", async () => {
    const w = await world();
    await w.schedule(TOMORROW);
    const tallies = await Promise.all([w.tick(MOMENT), w.tick(MOMENT)]);
    expect(tallies.map((t) => t.scheduled).sort()).toEqual([0, 1]);
    expect((await w.org.collection("issuedNumbers").get()).size).toBe(1);
    expect(w.mailer.sent).toHaveLength(1);
  }, RACE_TIMEOUT_MS);

  test("Send invoice on a scheduled draft sends it now and drops the schedule; the tick then sends nothing", async () => {
    const w = await world();
    await w.schedule(TOMORROW);
    expect(await w.send()).toMatchObject({ number: "INV-0001" });
    expect(await w.stored()).toBeUndefined();
    expect(await w.invoice()).toMatchObject({ issueDate: "2026-11-19" });
    expect((await w.tick(MOMENT)).scheduled).toBe(0);
    expect(w.mailer.sent).toHaveLength(1);
  });

  test("a draft it cannot send: nothing numbered, the problem recorded, the owner emailed once", async () => {
    const w = await world();
    await w.schedule(TOMORROW);
    await w.org.collection("tenants").doc("c1").delete();
    await w.tick(MOMENT);
    expect(await w.counter()).toBe(1);
    expect(await w.invoice()).toBeUndefined();
    expect((await w.org.collection("drafts").doc(w.draftId).get()).exists).toBe(true);
    expect(await w.stored()).toEqual({
      sendOn: TOMORROW, customerName: "Kila Trading", scheduledBy: w.uid, scheduledAt: Timestamp.fromDate(NOW),
      problem: "Choose who this invoice is for.", failedAt: Timestamp.fromDate(MOMENT),
    });
    expect(w.mailer.sent).toHaveLength(1);
    const owner = (await w.org.get()).get("email") as string;
    expect(w.mailer.sent[0]).toMatchObject({ to: owner, subject: "Not sent: your invoice for Kila Trading" });
    expect(w.mailer.sent[0]?.text).toContain("was due to go to Kila Trading at 8:00 am, Friday 20 November 2026, but was not sent: Choose who this invoice is for.");
    expect(w.mailer.sent[0]?.text).toContain(`https://sasimem.example/one-off/${w.draftId}`);

    await w.tick(new Date(MOMENT.getTime() + 3_600_000));
    expect(w.mailer.sent).toHaveLength(1);
  });

  test("the tick clears the schedule of a deleted draft", async () => {
    const w = await world();
    await w.schedule(TOMORROW);
    await w.org.collection("drafts").doc(w.draftId).delete();
    expect((await w.tick(MOMENT)).scheduled).toBe(0);
    expect(await w.stored()).toBeUndefined();
    expect(w.mailer.sent).toEqual([]);
  });
});
