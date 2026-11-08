/**
 * T1, as `pnpm test:unit` runs it (plan §9.3). Any T1 test over 100 ms is timed again,
 * alone, and fails only if it is slow both times: on a shared machine another session's
 * load pushes ordinary tests past 100 ms at random, and a gate that fails at random
 * breaks plan §9.5. A test that is really slow is slow twice and still fails.
 * In CI (CI=true) there is no second timing: the single strict measurement stands.
 *
 *   node tools/test-unit.ts [extra vitest arguments, e.g. --coverage]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SlowTest } from "./slow-test-reporter.ts";

const PROJECTS = ["core-unit", "web-unit", "ops-unit"];
const vitest = (args: readonly string[], env: NodeJS.ProcessEnv) =>
  spawnSync("pnpm", ["exec", "vitest", "run", ...args], { stdio: "inherit", env }).status ?? 1;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function main(): number {
  const extra = process.argv.slice(2);
  const all = [...PROJECTS.flatMap((p) => ["--project", p]), "--maxWorkers=2", "--slowTestThreshold", "50", ...extra];
  if (process.env["CI"] === "true") return vitest(all, process.env);

  const dir = mkdtempSync(join(tmpdir(), "t1-"));
  try {
    const list = join(dir, "slow.json");
    const first = vitest(all, { ...process.env, T1_SLOW_LIST: list });
    if (first !== 0) return first; // a real failure: nothing to time again
    const slow = JSON.parse(readFileSync(list, "utf8")) as SlowTest[];
    if (slow.length === 0) return 0;

    console.log(`\n${slow.length} T1 test(s) went over 100 ms. Timing them again, alone; each fails only if slow twice.\n`);
    const projects = [...new Set(slow.map((t) => t.project))].flatMap((p) => ["--project", p]);
    const files = [...new Set(slow.map((t) => t.file))];
    const names = `(${[...new Set(slow.map((t) => escape(t.name)))].join("|")})$`;
    const { T1_SLOW_LIST: _drop, ...strict } = process.env;
    return vitest([...projects, ...files, "--testNamePattern", names, "--maxWorkers=1"], strict);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exitCode = main();
