import { expect, test } from "vitest";
import * as billing from "./billing.js";
import { parsePeriod, type CalendarDate } from "./period.js";
import { toea } from "./money.js";
import * as messages from "./messages.js";

const sendAt = new Date("2026-09-30T22:00:00Z"); // 8:00 am, 1 October, Port Moresby

test("a draft run asked for approval before its send time waits for the landlord", () => {
  expect(billing.approvalTarget({ sendAt }, new Date("2026-09-30T21:59:59Z"))).toBe("awaitingApproval");
});

test("a draft run asked for approval at or after its send time is held: it is already late", () => {
  expect(billing.approvalTarget({ sendAt }, sendAt)).toBe("held");
  expect(billing.approvalTarget({ sendAt }, new Date("2026-10-05T00:00:00Z"))).toBe("held");
});

test("a tenant's invoice email names the number, the landlord, the amount and the due date", () => {
  expect(messages.tenantInvoiceSubject({ number: "INV-0142", orgName: "Wari Holdings", totalToea: toea(120_000), dueDate: "2026-10-08" as CalendarDate }))
    .toBe("Invoice INV-0142 from Wari Holdings - K1,200.00 due 8 October 2026");
});

test("a reminder says so first", () => {
  expect(messages.reminderSubject({ number: "INV-0142", orgName: "Wari Holdings", totalToea: toea(120_000), dueDate: "2026-10-08" as CalendarDate }))
    .toBe("Reminder: invoice INV-0142 from Wari Holdings - K1,200.00 was due 8 October 2026");
});

test("the landlord's dispatch notice names the month and how many went out", () => {
  expect(messages.dispatchSubject({ period: parsePeriod("2026-10"), count: 5 })).toBe("Sent - your October 2026 invoices are with your 5 tenants");
  expect(messages.dispatchSubject({ period: parsePeriod("2026-10"), count: 1 })).toBe("Sent - your October 2026 invoice is with your tenant");
});

test("the held notice says plainly that nothing was sent", () => {
  expect(messages.heldSubject(parsePeriod("2026-10"))).toBe("Held: your October 2026 invoices were not sent");
});
