import { expect, test } from "vitest";
import * as period from "./period.js";

test("a period is a calendar month written YYYY-MM, read with surrounding spaces trimmed", () => {
  expect(period.parsePeriod("2026-10")).toBe("2026-10");
  expect(period.parsePeriod(" 2026-10 ")).toBe("2026-10");
});
