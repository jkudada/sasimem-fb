/**
 * The hourly tick (plan §6.4), driven by an injected clock. Each test runs the tick
 * over its own orgs only (the orgIds filter, plan §9.3).
 */
import { parsePeriod } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeReissueApproval } from "../src/callables/runs.js";
import type { Mail } from "../src/mail/mailer.js";
import { approveRun } from "../src/store/approval.js";
import { renderMissingPdfs } from "../src/store/pdfs.js";
import { draftRun } from "../src/store/runs.js";
import { lookupToken } from "../src/store/tokens.js";
import { recordTickDone, runTick, tickAndLog, type TickDeps } from "../src/tick.js";
import { request } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";
import { FakeMailer, tokens } from "./harness/mailer.js";
import { anOrgWith, type TenancySeed } from "./harness/seed.js";

const OCT = parsePeriod("2026-10");
// Billing day 1, send hour 8, lead 3 days, Port Moresby (UTC+10):
const BEFORE_LEAD = new Date("2026-09-27T21:59:00Z");
const LEAD = new Date("2026-09-27T22:00:00Z"); // approval lead time begins
const SEND = new Date("2026-09-30T22:00:00Z"); // 8:00 am, 1 October
const HOUR = 3_600_000;
const DAY = 86_400_000;
const LANDLORD = "mary@wari.example";

/** A mailer that refuses one address, as Resend would refuse a bad one. */
class Mailbox extends FakeMailer {
  constructor(private readonly refuse: string | null = null) { super(); }
  override async send(mail: Mail): Promise<{ id: string }> {
    if (mail.to === this.refuse) throw new Error("Resend refused the message (422): Invalid `to` field.");
    return super.send(mail);
  }
}

async function world(tenancies: TenancySeed[] = [{ id: "k1", tenantName: "Peter Kila", rent: 120_000 }, { id: "k2", tenantName: "Mary Wari", rent: 90_000 }], opts: { refuse?: string; org?: Record<string, unknown> } = {}) {
  const { uid, orgId } = await anOrgWith({ tenancies, ...(opts.org === undefined ? {} : { org: opts.org }) });
  const mailer = new Mailbox(opts.refuse ?? null);
  const t = tokens();
  let now = LEAD;
  const deps: TickDeps = { now: () => now, mailer, newToken: t.next, appUrl: () => "https://sasimem.example" };
  return {
    uid, orgId, mailer, tok: t.nth, deps,
    tick: (at: Date, orgIds = [orgId]) => { now = at; return runTick(deps, { orgIds }); },
    run: async () => (await adminDb().doc(`orgs/${orgId}/runs/2026-10`).get()).data() ?? {},
    invoice: async (id: string) => (await adminDb().doc(`orgs/${orgId}/invoices/${id}`).get()).data() ?? {},
    log: async () => (await adminDb().collection(`orgs/${orgId}/emails`).get()).docs.map((d) => d.data()),
    approve: () => approveRun(orgId, OCT, { actor: "uid", now }).then(() => renderMissingPdfs(orgId, OCT)),
  };
}

describe("tick step 1: draft (plan §3.4)", () => {
  test("drafts a month once its approval lead time begins, and not before", async () => {
    const w = await world();
    await w.tick(BEFORE_LEAD);
    expect((await adminDb().doc(`orgs/${w.orgId}/runs/2026-10`).get()).exists).toBe(false);
    expect((await w.tick(LEAD)).drafted).toBe(1);
    expect(await w.run()).toMatchObject({ invoiceCount: 2, totalToea: 210_000 });
  });

  test("a second tick drafts nothing new (I1, I2)", async () => {
    const w = await world();
    await w.tick(LEAD);
    expect((await w.tick(new Date(LEAD.getTime() + HOUR))).drafted).toBe(0);
    expect((await adminDb().collection(`orgs/${w.orgId}/invoices`).get()).size).toBe(2);
  });

  test("past the send time, a new landlord's month is left alone, but a billing landlord's is drafted and held (an outage)", async () => {
    const late = new Date("2026-10-05T00:00:00Z");
    const newcomer = await world();
    expect((await newcomer.tick(late)).drafted).toBe(0);

    const billing = await world();
    await draftRun(billing.orgId, parsePeriod("2026-09"), new Date("2026-08-28T00:00:00Z"));
    await adminDb().doc(`orgs/${billing.orgId}/runs/2026-09`).update({ status: "sent" });
    expect(await billing.tick(late)).toMatchObject({ drafted: 1, requested: 1 });
    expect((await billing.run())["status"]).toBe("held");
  });
});

describe("tick step 2: request approval", () => {
  test("a drafted month asks the landlord, once, with a digest carrying a working link", async () => {
    const w = await world();
    expect((await w.tick(LEAD)).requested).toBe(1);
    expect((await w.run())["status"]).toBe("awaitingApproval");
    const [digest] = w.mailer.to(LANDLORD);
    expect(digest?.subject).toBe("2 invoices ready for October 2026 - K2,100.00");
    expect(digest?.text).toContain(`https://sasimem.example/a/${w.tok(1)}`);
    expect((await lookupToken(w.tok(1), LEAD)).state).toBe("live");
    await w.tick(new Date(LEAD.getTime() + HOUR));
    expect(w.mailer.sent).toHaveLength(1);
  });

  test("a month asked for after its send time goes straight to held, with one email saying approval sends it within the hour", async () => {
    const w = await world();
    await draftRun(w.orgId, OCT, LEAD); // drafted, but the request never happened (an outage)
    await w.tick(new Date(SEND.getTime() + HOUR));
    expect(await w.run()).toMatchObject({ status: "held" });
    expect(w.mailer.sent).toHaveLength(1);
    expect(w.mailer.sent[0]?.text).toContain("they go out within the hour");
  });

  test("two overlapping ticks send one digest", async () => {
    const w = await world();
    await Promise.all([w.tick(LEAD), w.tick(LEAD)]);
    expect(w.mailer.to(LANDLORD)).toHaveLength(1);
  });
});

describe("tick step 3: release (I6)", () => {
  test("at the send time an approved month is sent, and so is each of its invoices", async () => {
    const w = await world();
    await w.tick(LEAD);
    await w.approve();
    expect((await w.tick(SEND)).sent).toBe(1);
    expect(await w.run()).toMatchObject({ status: "sent", sentAt: Timestamp.fromDate(SEND) });
    expect(await w.invoice("k1_2026-10")).toMatchObject({ status: "sent", sentAt: Timestamp.fromDate(SEND) });
  });

  test("each tenant gets their own invoice with its PDF, replies going to the landlord, and each send is logged", async () => {
    const w = await world();
    await w.tick(LEAD);
    await w.approve();
    await w.tick(SEND);
    const [mail] = w.mailer.to("k1@tenant.example");
    expect(mail).toMatchObject({ fromName: "Wari Holdings", replyTo: LANDLORD });
    expect(mail?.subject).toMatch(/^Invoice INV-000\d from Wari Holdings - K1,200.00 due 8 October 2026$/);
    expect(mail?.text).toContain("K1-OCT26"); // the payment reference
    expect(mail?.attachments?.[0]?.filename).toMatch(/^INV-000\d\.pdf$/);
    expect(mail?.attachments?.[0]?.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await w.log()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "tenantInvoice", to: "k1@tenant.example", invoiceId: "k1_2026-10", status: "sent" })]));
  });

  test("the landlord is told the month went out; a month with every tenant left out sends nothing at all", async () => {
    const w = await world();
    await w.tick(LEAD);
    await w.approve();
    await w.tick(SEND);
    expect(w.mailer.to(LANDLORD).map((m) => m.subject)).toContain("Sent - your October 2026 invoices are with your 2 tenants");

    const empty = await world([{ id: "k1" }]);
    await empty.tick(LEAD);
    await approveRun(empty.orgId, OCT, { actor: "uid", now: LEAD, edits: { rents: {}, included: [] } });
    await empty.tick(SEND);
    expect((await empty.run())["status"]).toBe("sent");
    expect(empty.mailer.sent).toHaveLength(1); // the digest, nothing after
  });

  test("an approved month waits for its send time, and a month never approved never goes", async () => {
    const w = await world();
    await w.tick(LEAD);
    await w.approve();
    await w.tick(new Date(SEND.getTime() - 1));
    expect((await w.run())["status"]).toBe("approved");
    const silent = await world();
    await silent.tick(LEAD);
    await silent.tick(new Date(SEND.getTime() + 10 * DAY));
    expect(silent.mailer.sent.filter((m) => m.to.endsWith("@tenant.example"))).toEqual([]);
  });

  test("two overlapping ticks send each tenant one email", async () => {
    const w = await world();
    await w.tick(LEAD);
    await w.approve();
    await Promise.all([w.tick(SEND), w.tick(SEND)]);
    expect(w.mailer.to("k1@tenant.example")).toHaveLength(1);
    expect(w.mailer.to("k2@tenant.example")).toHaveLength(1);
    expect(w.mailer.to(LANDLORD).filter((m) => m.subject.startsWith("Sent"))).toHaveLength(1);
  });

  test("a tenant address that is refused is logged as failed, the others still go, the landlord is told, and the tick fails visibly", async () => {
    const w = await world(undefined, { refuse: "k1@tenant.example" });
    await w.tick(LEAD);
    await w.approve();
    await expect(w.tick(SEND)).rejects.toThrow("Invalid `to` field.");
    expect(w.mailer.to("k2@tenant.example")).toHaveLength(1);
    expect(await w.log()).toEqual(expect.arrayContaining([expect.objectContaining({ to: "k1@tenant.example", status: "failed" })]));
    const notice = w.mailer.to(LANDLORD).find((m) => m.subject.startsWith("Sent"));
    expect(notice?.subject).toBe("Sent - your October 2026 invoice is with your tenant");
    expect(notice?.text).toContain("Peter Kila: not sent");
  });

  test("one landlord's failure does not stop another's month", async () => {
    const a = await world([{ id: "k1" }], { refuse: "k1@tenant.example" });
    const b = await world([{ id: "k1" }]);
    for (const w of [a, b]) { await w.tick(LEAD); await w.approve(); }
    await expect(a.tick(SEND, [a.orgId, b.orgId])).rejects.toThrow();
    expect((await b.run())["status"]).toBe("sent");
  });
});

describe("tick step 4: hold", () => {
  test("a month still waiting at its send time is held, not sent; its link lives 7 more days and the held notice carries a working link", async () => {
    const w = await world();
    await w.tick(LEAD);
    expect((await w.tick(SEND)).held).toBe(1);
    expect(await w.run()).toMatchObject({ status: "held", heldNotifiedAt: Timestamp.fromDate(SEND), approvalExpiresAt: Timestamp.fromMillis(SEND.getTime() + 7 * DAY) });
    const held = w.mailer.to(LANDLORD)[1];
    expect(held?.subject).toBe("Held: your October 2026 invoices were not sent");
    expect(held?.text).toContain(`https://sasimem.example/a/${w.tok(2)}`);
    const later = new Date(SEND.getTime() + 6 * DAY);
    expect((await lookupToken(w.tok(2), later)).state).toBe("live");
    expect((await lookupToken(w.tok(1), later)).state).toBe("live"); // the digest's link still works
    expect(w.mailer.sent.filter((m) => m.to.endsWith("@tenant.example"))).toEqual([]);
    await w.tick(new Date(SEND.getTime() + HOUR));
    expect(w.mailer.sent).toHaveLength(2); // held once
  });

  test("a new link retires both the digest's link and the held notice's", async () => {
    const w = await world();
    await w.tick(LEAD);
    await w.tick(SEND);
    await makeReissueApproval({ ...w.deps, now: () => new Date("2026-10-01T00:00:00Z") }).run(request(w.uid, { orgId: w.orgId, period: "2026-10" }));
    const at = new Date("2026-10-01T00:00:00Z");
    expect((await lookupToken(w.tok(1), at)).state).toBe("dead");
    expect((await lookupToken(w.tok(2), at)).state).toBe("dead");
    expect((await lookupToken(w.tok(3), at)).state).toBe("live");
  });

  test("held, then approved late, then sent at the next tick", async () => {
    const w = await world();
    await w.tick(LEAD);
    await w.tick(SEND);
    await w.approve();
    await w.tick(new Date(SEND.getTime() + 2 * HOUR));
    expect((await w.run())["status"]).toBe("sent");
    expect(w.mailer.to("k1@tenant.example")).toHaveLength(1);
  });
});

describe("tick step 5: remind (I8)", () => {
  // Due 8 October; 7 days after is 15 October, Port Moresby, which begins 14:00Z on the 14th.
  const REMIND = new Date("2026-10-14T14:00:00Z");

  async function sentMonth(opts: { org?: Record<string, unknown> } = {}) {
    const w = await world([{ id: "k1", tenantName: "Peter Kila" }], opts);
    await w.tick(LEAD);
    await w.approve();
    await w.tick(SEND);
    return w;
  }

  test("an unpaid invoice is reminded once, with its PDF, on its due date plus the reminder days, and not a moment before", async () => {
    const w = await sentMonth();
    expect((await w.tick(new Date(REMIND.getTime() - 1))).reminded).toBe(0);
    expect((await w.tick(REMIND)).reminded).toBe(1);
    const reminder = w.mailer.to("k1@tenant.example")[1];
    expect(reminder?.subject).toMatch(/^Reminder: invoice INV-0001 from Wari Holdings - K1,200.00 was due 8 October 2026$/);
    expect(reminder?.attachments?.[0]?.filename).toBe("INV-0001.pdf");
    expect((await w.invoice("k1_2026-10"))["remindedAt"]).toEqual(Timestamp.fromDate(REMIND));
    expect(await w.log()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "reminder", invoiceId: "k1_2026-10" })]));
  });

  test("two overlapping ticks send one reminder, and no later tick sends another (I8)", async () => {
    const w = await sentMonth();
    await Promise.all([w.tick(REMIND), w.tick(REMIND)]);
    await w.tick(new Date(REMIND.getTime() + 30 * DAY));
    expect(w.mailer.to("k1@tenant.example")).toHaveLength(2); // the invoice and one reminder
  });

  test("a paid invoice, a paused one, and an org with reminders off are left alone", async () => {
    const paid = await sentMonth();
    await adminDb().doc(`orgs/${paid.orgId}/invoices/k1_2026-10`).update({ status: "paid", paidAt: Timestamp.fromDate(SEND) });
    const paused = await sentMonth();
    await adminDb().doc(`orgs/${paused.orgId}/invoices/k1_2026-10`).update({ remindersPaused: true });
    const off = await sentMonth({ org: { reminderMode: "off" } });
    for (const w of [paid, paused, off]) expect((await w.tick(REMIND)).reminded).toBe(0);
  });
});

describe("the tick as a whole", () => {
  test("reports what it did", async () => {
    const w = await world();
    expect(await w.tick(LEAD)).toEqual({ drafted: 1, requested: 1, sent: 0, held: 0, reminded: 0 });
  });

  test("after a crash between approval and rendering, the PDF is rendered at release and the invoice still goes with it (I5, I6)", async () => {
    const w = await world([{ id: "k1" }]);
    await w.tick(LEAD);
    await approveRun(w.orgId, OCT, { actor: "uid", now: LEAD }); // and then the process died
    expect((await w.invoice("k1_2026-10"))["pdfPath"]).toBe("");
    await w.tick(SEND);
    expect((await w.invoice("k1_2026-10"))["pdfPath"]).toBe(`invoices/${w.orgId}/k1_2026-10.pdf`);
    expect(w.mailer.to("k1@tenant.example")[0]?.attachments).toHaveLength(1);
  });

  test("a successful tick logs one \"tick done\" line with its tally, for the 3-hour alert; a failed one logs none", async () => {
    const lines: [string, object][] = [];
    const log = (msg: string, data: object) => void lines.push([msg, data]);
    const ok = await world([{ id: "k1" }]);
    await tickAndLog(ok.deps, { orgIds: [ok.orgId] }, log);
    expect(lines).toEqual([["tick done", { event: "tick_done", drafted: 1, requested: 1, sent: 0, held: 0, reminded: 0 }]]);

    lines.length = 0;
    const bad = await world([{ id: "k1" }], { refuse: LANDLORD }); // the digest is refused at LEAD
    await expect(tickAndLog(bad.deps, { orgIds: [bad.orgId] }, log)).rejects.toThrow();
    expect(lines).toEqual([]);
  });

  test("a successful full tick records when it ran, for the console's Health page; a tick scoped to some orgs does not", async () => {
    const at = new Date("2026-11-08T03:00:00Z");
    await recordTickDone(at, { drafted: 1, requested: 0, sent: 0, held: 0, reminded: 0 });
    expect((await adminDb().doc("system/tick").get()).data()).toEqual({
      lastSuccessAt: Timestamp.fromDate(at), tally: { drafted: 1, requested: 0, sent: 0, held: 0, reminded: 0 },
    });
    const scoped = await world([{ id: "k1" }]);
    await tickAndLog(scoped.deps, { orgIds: [scoped.orgId] }, () => undefined);
    expect((await adminDb().doc("system/tick").get()).get("lastSuccessAt")).toEqual(Timestamp.fromDate(at));
  });
});
