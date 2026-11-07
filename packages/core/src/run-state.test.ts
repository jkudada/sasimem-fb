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

  test("approval is requested for a draft run once its lead time begins, and only for a draft run", () => {
    const org = { approvalLeadDays: 3 };
    expect(billing.approvalRequestDue(run("draft"), org, at("2026-09-27T21:59:59Z"))).toBe(false);
    expect(billing.approvalRequestDue(run("draft"), org, at("2026-09-27T22:00:00Z"))).toBe(true);
    for (const status of ALL.filter((s) => s !== "draft")) {
      expect(billing.approvalRequestDue(run(status), org, at("2026-09-29T00:00:00Z")), status).toBe(false);
    }
  });
});
