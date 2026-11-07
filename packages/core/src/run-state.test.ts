import { expect, test } from "vitest";
import * as billing from "./billing.js";
import type { RunStatus } from "./types.js";

const ALL: RunStatus[] = ["draft", "awaitingApproval", "approved", "sent", "held", "cancelled"];

test("a run can be edited only before approval: draft, awaiting approval or held", () => {
  expect(ALL.filter(billing.isEditable)).toEqual(["draft", "awaitingApproval", "held"]);
});
