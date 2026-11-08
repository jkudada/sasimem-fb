/**
 * Invariant I8 (plan §1): an invoice reminder is sent at most once, ever. remindedAt
 * is set in the compare-and-set that claims the send, and never cleared. (The
 * tick-level cases are in tick.test.ts.)
 */
import { describe, expect, test } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { claimReminder } from "../../src/store/reminders.js";
import { adminDb } from "../harness/index.js";
import { anOrgWith } from "../harness/seed.js";

const org = { timezone: "Pacific/Port_Moresby", reminderMode: "auto" as const, reminderAfterDays: 7 };
const REMIND = new Date("2026-10-14T14:00:00Z");

async function sentInvoice() {
  const { orgId } = await anOrgWith();
  const ref = adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`);
  await ref.set({ status: "sent", dueDate: "2026-10-08", sentAt: Timestamp.fromDate(new Date("2026-09-30T22:00:00Z")), paidAt: null, remindedAt: null, remindersPaused: false });
  return ref;
}

describe("I8: one reminder, ever", () => {
  test("two concurrent claims: exactly one wins, and remindedAt is set", async () => {
    const ref = await sentInvoice();
    const claims = await Promise.all([claimReminder(ref, org, REMIND), claimReminder(ref, org, REMIND)]);
    expect(claims.filter((c) => c !== null)).toHaveLength(1);
    expect((await ref.get()).get("remindedAt")).toEqual(Timestamp.fromDate(REMIND));
  });

  test("a claim months later, with the invoice still unpaid, wins nothing", async () => {
    const ref = await sentInvoice();
    await claimReminder(ref, org, REMIND);
    expect(await claimReminder(ref, org, new Date("2027-03-01T00:00:00Z"))).toBeNull();
  });
});
