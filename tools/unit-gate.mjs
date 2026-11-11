/**
 * The pre-push T1 gate (lefthook.yml). Runs the unit tests as `pnpm test:unit` does. If
 * the only problem is the 100 ms per-test alarm (tools/slow-test-reporter.ts), it runs
 * the files holding the slow tests again, on one worker, up to three times, and fails
 * only if a test is over 100 ms every time. A test that is really slow is slow both times; a garbage-collection
 * pause on a shared machine is not. A failing test always fails the gate.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const PROJECTS = ["--project", "core-unit", "--project", "web-unit", "--project", "console-unit", "--project", "ops-unit"];
const dir = mkdtempSync(join(tmpdir(), "unit-gate-"));

/** workers: 2 for the whole run, as `pnpm test:unit`; 1 to re-time, so a test does not compete with its neighbours. */
function run(name, files, workers) {
  const out = join(dir, `${name}.json`);
  const res = spawnSync("pnpm", ["exec", "vitest", "run", ...PROJECTS, `--maxWorkers=${workers}`, "--slowTestThreshold", "50", ...files], {
    stdio: "inherit", env: { ...process.env, SLOW_TESTS_OUT: out },
  });
  let report;
  try {
    report = JSON.parse(readFileSync(out, "utf8"));
  } catch {
    report = null; // vitest stopped before reporting (a syntax error, say): its exit code stands
  }
  return { status: res.status ?? 1, report };
}

const first = run("first", [], 2);
if (first.status === 0) process.exit(0);
if (first.report === null || first.report.failed > 0 || first.report.slow.length === 0) process.exit(first.status);

// Up to three more tries, each only for the tests still slow, on one worker: a test that
// is really over 100 ms is over every time; a pause on a busy shared machine is not.
const TRIES = 3;
let slow = first.report.slow;
for (let i = 1; i <= TRIES && slow.length > 0; i++) {
  const files = [...new Set(slow.map((t) => relative(process.cwd(), t.file)))];
  console.error(`\nunit-gate: only the 100 ms alarm failed (${slow.length} test(s)); timing ${files.length} file(s) again (${i} of ${TRIES}).\n`);
  const again = run(`again-${i}`, files, 1);
  if (again.report === null) process.exit(again.status || 1);
  if (again.report.failed > 0) process.exit(1);
  slow = again.report.slow.filter((t) => slow.some((s) => s.name === t.name && s.project === t.project));
}
if (slow.length === 0) {
  console.error("unit-gate: every test that was slow came in under 100 ms when timed again - a pause, not a slow test. Passing.");
  process.exit(0);
}
for (const t of slow) console.error(`unit-gate: over 100 ms every time (last ${Math.round(t.ms)} ms): ${t.project} > ${t.name}`);
process.exit(1);
