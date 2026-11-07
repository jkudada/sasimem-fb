import { describe, expect, test } from "vitest";
import * as billing from "./billing.js";
import type { RunStatus } from "./types.js";

const ALL: RunStatus[] = ["draft", "awaitingApproval", "approved", "sent", "held", "cancelled"];

test("a run can be edited only before approval: draft, awaiting approval or held", () => {
  expect(ALL.filter(billing.isEditable)).toEqual(["draft", "awaitingApproval", "held"]);
});

describe("what the tick does to a run", () => {
  const sendAt = new Date("2026-09-30T22:00:00Z");
  const run = (status: RunStatus) => ({ status, sendAt });
  const at = (iso: string) => new Date(iso);

  test("an approved run is released at its send time, and nothing else ever is", () => {
    expect(billing.releaseDue(run("approved"), at("2026-09-30T21:59:59Z"))).toBe(false);
    expect(billing.releaseDue(run("approved"), at("2026-09-30T22:00:00Z"))).toBe(true);
    for (const status of ALL.filter((s) => s !== "approved")) {
      expect(billing.releaseDue(run(status), at("2026-10-05T00:00:00Z")), status).toBe(false);
    }
  });

  test("a run still waiting for approval at its send time is held: silence never means send", () => {
    expect(billing.holdDue(run("awaitingApproval"), at("2026-09-30T21:59:59Z"))).toBe(false);
    expect(billing.holdDue(run("awaitingApproval"), at("2026-09-30T22:00:00Z"))).toBe(true);
    for (const status of ALL.filter((s) => s !== "awaitingApproval")) {
      expect(billing.holdDue(run(status), at("2026-10-05T00:00:00Z")), status).toBe(false);
    }
  });

  test("approval is requested for a draft run once its lead time begins, and only for a draft run", () => {
    const org = { approvalLeadDays: 3 };
    expect(billing.approvalRequestDue(run("draft"), org, at("2026-09-27T21:59:59Z"))).toBe(false);
    expect(billing.approvalRequestDue(run("draft"), org, at("2026-09-27T22:00:00Z"))).toBe(true);
    for (const status of ALL.filter((s) => s !== "draft")) {
      expect(billing.approvalRequestDue(run(status), org, at("2026-09-29T00:00:00Z")), status).toBe(false);
    }
  });
});

describe("approving a run", () => {
  test("approving a run that is already approved or sent changes nothing (I4: two taps, two tabs)", () => {
    expect(billing.approvalOutcome("approved")).toBe("alreadyApproved");
    expect(billing.approvalOutcome("sent")).toBe("alreadyApproved");
  });

  test("a held run can still be approved late, like any editable run; a cancelled one cannot", () => {
    expect(billing.approvalOutcome("held")).toBe("approve");
    expect(billing.approvalOutcome("draft")).toBe("approve");
    expect(billing.approvalOutcome("awaitingApproval")).toBe("approve");
    expect(billing.approvalOutcome("cancelled")).toBe("refused");
  });
});

describe("taking a tenant out of the month's batch", () => {
  test("a draft invoice can be excluded, and an excluded one re-included, only while the run is editable", () => {
    expect(billing.canExclude("awaitingApproval", "draft")).toBe(true);
    expect(billing.canInclude("held", "excluded")).toBe(true);
    expect(billing.canExclude("approved", "approved")).toBe(false);
    expect(billing.canExclude("approved", "draft")).toBe(false);
    expect(billing.canInclude("sent", "excluded")).toBe(false);
    expect(billing.canExclude("draft", "excluded")).toBe(false);
    expect(billing.canInclude("draft", "draft")).toBe(false);
  });
});

describe("paid ticks", () => {
  const monday = new Date("2026-10-12T01:00:00Z");

  test("a sent invoice marked paid records when", () => {
    expect(billing.markPaid({ status: "sent", paidAt: null }, monday)).toEqual({ status: "paid", paidAt: monday });
  });

  test("only a sent invoice can be marked paid", () => {
    for (const status of ["draft", "excluded", "approved", "void"] as const) {
      expect(() => billing.markPaid({ status, paidAt: null }, monday), status).toThrow(billing.NotAllowed);
    }
  });

  test("a paid tick is reversible; unmarking anything else changes nothing", () => {
    expect(billing.markUnpaid({ status: "paid", paidAt: monday })).toEqual({ status: "sent", paidAt: null });
    expect(billing.markUnpaid({ status: "sent", paidAt: null })).toEqual({ status: "sent", paidAt: null });
  });

  test("marking an already-paid invoice paid again is a no-op that keeps the original date", () => {
    const tuesday = new Date("2026-10-13T01:00:00Z");
    expect(billing.markPaid({ status: "paid", paidAt: monday }, tuesday)).toEqual({ status: "paid", paidAt: monday });
  });
});

describe("invoice numbers", () => {
  test("an invoice number is the org's prefix and the number padded to four digits", () => {
    expect(billing.invoiceNumber("INV-", 7)).toBe("INV-0007");
    expect(billing.invoiceNumber("INV-", 142)).toBe("INV-0142");
    expect(billing.invoiceNumber("WR/", 12345)).toBe("WR/12345");
  });

  test("numbers are given in sequence from the counter, by tenant name and then tenancy id", () => {
    const allocation = billing.allocateNumbers({
      prefix: "INV-",
      nextNumber: 142,
      invoices: [
        { id: "t3_2026-10", tenancyId: "t3", tenantName: "Peter Wari", status: "draft" },
        { id: "t2_2026-10", tenancyId: "t2", tenantName: "Kila Trading", status: "draft" },
        { id: "t1_2026-10", tenancyId: "t1", tenantName: "Kila Trading", status: "draft" },
      ],
    });
    expect(allocation).toEqual({
      numbers: [
        { invoiceId: "t1_2026-10", number: "INV-0142" },
        { invoiceId: "t2_2026-10", number: "INV-0143" },
        { invoiceId: "t3_2026-10", number: "INV-0144" },
      ],
      nextNumber: 145,
    });
  });
});
