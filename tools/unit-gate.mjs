/**
 * The pre-push T1 gate (lefthook.yml). Runs the unit tests as `pnpm test:unit` does.
 * A failing test fails the push. A test over the 100 ms alarm (tools/slow-test-reporter.ts)
 * is reported here but does not: CI's T1 job runs `pnpm test:unit` and fails on it, so
 * the alarm still holds before anything merges (plan §9.3).
 *
 * Why not here: this machine is shared by several sessions running their own tests at
 * once. Measured 2026-11-18, the same test took 42 ms of CPU in one run and 238 ms in
 * the next, and dozens of 40-100 ms screen tests went over together whenever the machine
 * was busy. Re-timing them (up to three times) still failed pushes at random and added
 * minutes to each. A push that fails for reasons the change did not cause breaks plan §9.5.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECTS = ["--project", "core-unit", "--project", "web-unit", "--project", "console-unit", "--project", "ops-unit"];
const out = join(mkdtempSync(join(tmpdir(), "unit-gate-")), "report.json");

const res = spawnSync("pnpm", ["exec", "vitest", "run", ...PROJECTS, "--maxWorkers=2", "--slowTestThreshold", "50"], {
  stdio: "inherit", env: { ...process.env, SLOW_TESTS_OUT: out },
});
if (res.status === 0) process.exit(0);

let report;
try {
  report = JSON.parse(readFileSync(out, "utf8"));
} catch {
  process.exit(res.status ?? 1); // vitest stopped before reporting (a syntax error, say): its exit code stands
}
if (report.failed > 0 || report.slow.length === 0) process.exit(res.status ?? 1);

console.error(
  `\nunit-gate: every test passed. ${report.slow.length} went over the 100 ms alarm on this machine (listed above).` +
    "\nNot failing the push for that: CI's T1 job enforces the alarm on its own runners. If one of yours is" +
    "\nover there too, it is really slow - make it lighter or move it to another tier.\n",
);
process.exit(0);
