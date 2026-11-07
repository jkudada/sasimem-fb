import { expect, test } from "vitest";
import { anOrg } from "../testing/index.js";
import * as billing from "./billing.js";
import type { CalendarDate } from "./period.js";

// Due 8 October; with the default 7 days the reminder is earned on 15 October,
// counted in Port Moresby (UTC+10), where 15 October starts at 2026-10-14T14:00Z.
const org = anOrg().remindAfter(7).build();
const sent: billing.ReminderCandidate = {
  status: "sent",
  dueDate: "2026-10-08" as CalendarDate,
  sentAt: new Date("2026-09-30T22:00:00Z"),
  paidAt: null,
  remindedAt: null,
  remindersPaused: false,
};
const onTheDay = new Date("2026-10-14T14:00:00Z");

test("an unpaid invoice earns its reminder on the due date plus the org's reminder days, and not a day before", () => {
  expect(billing.reminderDue({ invoice: sent, org, now: new Date("2026-10-14T13:59:59Z") })).toBe(false);
  expect(billing.reminderDue({ invoice: sent, org, now: onTheDay })).toBe(true);
  // Zero days means the due date itself (the reference app's rule: day >= due + 0).
  const sameDay = anOrg().remindAfter(0).build();
  expect(billing.reminderDue({ invoice: sent, org: sameDay, now: new Date("2026-10-07T14:00:00Z") })).toBe(true);
  expect(billing.reminderDue({ invoice: sent, org: sameDay, now: new Date("2026-10-07T13:59:59Z") })).toBe(false);
});

test("the landlord's calendar day decides, not the server's", () => {
  // 14:00Z on 14 October is already 15 October in Port Moresby, though not in UTC.
  expect(billing.reminderDue({ invoice: sent, org, now: onTheDay })).toBe(true);
  expect(billing.reminderDue({ invoice: sent, org: anOrg().remindAfter(7).inTimezone("UTC").build(), now: onTheDay })).toBe(false);
});

test("a paid invoice is never chased, whether or not its status says so", () => {
  expect(billing.reminderDue({ invoice: { ...sent, status: "paid", paidAt: onTheDay }, org, now: onTheDay })).toBe(false);
  expect(billing.reminderDue({ invoice: { ...sent, paidAt: onTheDay }, org, now: onTheDay })).toBe(false);
});

test("only an invoice that reached the tenant can be chased", () => {
  for (const status of ["draft", "excluded", "approved", "void"] as const) {
    expect(billing.reminderDue({ invoice: { ...sent, status }, org, now: onTheDay }), status).toBe(false);
  }
});

test("an invoice whose reminders the landlord paused is left alone", () => {
  expect(billing.reminderDue({ invoice: { ...sent, remindersPaused: true }, org, now: onTheDay })).toBe(false);
});

test("an invoice is reminded at most once, ever (I8)", () => {
  expect(billing.reminderDue({ invoice: { ...sent, remindedAt: onTheDay }, org, now: new Date("2026-12-01T00:00:00Z") })).toBe(false);
});

test("an organisation can turn reminders off entirely", () => {
  expect(billing.reminderDue({ invoice: sent, org: anOrg().remindersOff().build(), now: onTheDay })).toBe(false);
});
