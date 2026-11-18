/**
 * A setup file for every T1 project: records the CPU time each test spends on its own
 * thread, for tools/slow-test-reporter.ts. The 100 ms alarm (plan §9.3) is about a test
 * doing too much work. Wall time also counts time spent waiting for a core while other
 * sessions on a shared machine run their own tests: it was measured at 77, 1040 and
 * 126 ms for one test in three runs, which failed pushes at random. A thread's CPU time
 * counts only its own work.
 *
 * Per thread, not per process: console-unit runs its files as threads in one process.
 * Hooks are a stack, so this beforeEach runs first and this afterEach last: the window
 * holds the test and its other hooks (rendering, cleanup), which are its cost too.
 */
import { afterEach, beforeEach } from "vitest";

let start: NodeJS.CpuUsage | undefined;

beforeEach(() => {
  start = process.threadCpuUsage();
});

afterEach(({ task }) => {
  if (start === undefined) return;
  const used = process.threadCpuUsage(start);
  (task.meta as { cpuMs?: number }).cpuMs = (used.user + used.system) / 1000;
});
