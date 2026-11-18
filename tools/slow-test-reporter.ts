import { appendFileSync, writeFileSync } from "node:fs";
import type { Reporter, TestCase, TestModule } from "vitest/node";

// Plan §9.3: list the ten slowest tests, and fail any T1 test over 100 ms -
// it is secretly an integration test and belongs in another tier.
// "100 ms" is the CPU time the test's own thread used (tools/cpu-clock.ts), not wall
// time. On this shared 4-core machine other sessions' test runs took the cores, and a
// 77 ms test measured 1040 ms by the wall clock: pushes failed at random, whatever
// the tests did (plan §9.5). Wall time still has a backstop, T1_WALL_BACKSTOP_MS, for
// a test that waits rather than works; T1 tests may not sleep (eslint), so it is rare.
// T1 runs on 2 workers (package.json test:unit). The pre-push hook runs
// tools/unit-gate.mjs: with SLOW_TESTS_OUT set, this reporter writes what was slow (and
// whether anything failed) there, and the gate reports the slow ones without failing the
// push; CI fails on them.
const T1_PROJECTS = new Set(["core-unit", "web-unit", "console-unit", "ops-unit"]);
const T1_HARD_LIMIT_MS = 100;
const T1_WALL_BACKSTOP_MS = 2000;

export default class SlowTestReporter implements Reporter {
  /** ms: what the alarm judges - CPU time when the clock ran, else wall time. */
  private readonly timings: { name: string; project: string; file: string; ms: number; wallMs: number; cpuMs: number | null }[] = [];
  private failed = 0;

  onTestCaseResult(test: TestCase): void {
    const wallMs = test.diagnostic()?.duration ?? 0;
    const cpuMs = (test.meta() as { cpuMs?: number }).cpuMs ?? null;
    this.timings.push({ name: test.fullName, project: test.project.name, file: test.module.moduleId, ms: cpuMs ?? wallMs, wallMs, cpuMs });
    if (test.result().state === "failed") this.failed++;
  }

  onTestRunEnd(_modules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<unknown>, reason: string): void {
    const slowest = [...this.timings].sort((a, b) => b.ms - a.ms).slice(0, 10);
    const cpu = (t: { cpuMs: number | null }) => (t.cpuMs === null ? "-" : `${t.cpuMs.toFixed(1)} ms`);
    const rows = slowest.map((t) => `| ${cpu(t)} | ${t.wallMs.toFixed(1)} ms | ${t.project} | ${t.name} |`);
    const table = ["| CPU | Wall | Tier | Test |", "|---:|---:|---|---|", ...rows].join("\n");
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary) appendFileSync(summary, `\n### Ten slowest tests\n\n${table}\n`);

    const tooSlow = this.timings.filter((t) => T1_PROJECTS.has(t.project) && (t.ms > T1_HARD_LIMIT_MS || t.wallMs > T1_WALL_BACKSTOP_MS));
    const out = process.env["SLOW_TESTS_OUT"];
    // Errors outside any test, or a run that did not finish, fail the gate like a failed test.
    if (out) writeFileSync(out, JSON.stringify({ failed: this.failed + unhandledErrors.length + (reason === "passed" || reason === "failed" ? 0 : 1), slow: tooSlow }));
    if (tooSlow.length > 0) {
      for (const t of tooSlow) {
        const why = t.ms > T1_HARD_LIMIT_MS ? `over ${T1_HARD_LIMIT_MS} ms of ${t.cpuMs === null ? "wall" : "CPU"} time (${t.ms.toFixed(0)} ms)` : `over ${T1_WALL_BACKSTOP_MS} ms by the wall clock (${t.wallMs.toFixed(0)} ms)`;
        console.error(`T1 test ${why}: ${t.project} > ${t.name}`);
      }
      process.exitCode = 1;
    }
  }
}
