import { appendFileSync, writeFileSync } from "node:fs";
import type { Reporter, TestCase } from "vitest/node";

// Plan §9.3: list the ten slowest tests, and fail any T1 test over 100 ms -
// it is secretly an integration test and belongs in another tier.
// T1 runs on 2 workers (package.json test:unit): with 4 happy-dom files at once on a
// 4-core machine, garbage-collection pauses pushed ordinary 30 ms tests past 100 ms
// at random (measured 2026-11-07: slowest 128-209 ms on 4 workers, 59-90 ms on 2,
// for ~6 s more wall time). A gate that fails at random would break plan §9.5.
//
// On a shared machine that is not enough: another session's tests or emulators take
// the CPU and ordinary 60-90 ms tests cross 100 ms at random. So tools/test-unit.ts
// sets T1_SLOW_LIST: this reporter then writes the slow tests to that file instead of
// failing, and the wrapper times just those again, alone. A test fails only if it is
// slow twice. CI runs without it, so CI keeps the strict single measurement.
export const T1_PROJECTS = new Set(["core-unit", "web-unit", "ops-unit"]);
export const T1_HARD_LIMIT_MS = 100;

/** A slow T1 test, as tools/test-unit.ts reads it back. */
export interface SlowTest {
  readonly project: string;
  readonly file: string;
  readonly name: string;
  readonly fullName: string;
  readonly ms: number;
}

export default class SlowTestReporter implements Reporter {
  private readonly timings: SlowTest[] = [];

  onTestCaseResult(test: TestCase): void {
    const ms = test.diagnostic()?.duration ?? 0;
    this.timings.push({ fullName: test.fullName, name: test.name, file: test.module.moduleId, project: test.project.name, ms });
  }

  onTestRunEnd(): void {
    const slowest = [...this.timings].sort((a, b) => b.ms - a.ms).slice(0, 10);
    const rows = slowest.map((t) => `| ${t.ms.toFixed(1)} ms | ${t.project} | ${t.fullName} |`);
    const table = ["| Time | Tier | Test |", "|---:|---|---|", ...rows].join("\n");
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary) appendFileSync(summary, `\n### Ten slowest tests\n\n${table}\n`);

    const tooSlow = this.timings.filter((t) => T1_PROJECTS.has(t.project) && t.ms > T1_HARD_LIMIT_MS);
    const recheckList = process.env["T1_SLOW_LIST"];
    if (recheckList !== undefined && recheckList !== "") {
      writeFileSync(recheckList, JSON.stringify(tooSlow));
      for (const t of tooSlow) console.error(`T1 test over ${T1_HARD_LIMIT_MS} ms (${t.ms.toFixed(0)} ms), to be timed again: ${t.project} > ${t.fullName}`);
    } else if (tooSlow.length > 0) {
      for (const t of tooSlow) console.error(`T1 test over ${T1_HARD_LIMIT_MS} ms (${t.ms.toFixed(0)} ms): ${t.project} > ${t.fullName}`);
      process.exitCode = 1;
    }
  }
}
