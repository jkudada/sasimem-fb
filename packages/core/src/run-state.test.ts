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
});
