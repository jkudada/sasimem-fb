// Nightly mutation gate (plan §9.4): overall >= 80% on core, 100% on money.ts and gst.ts.
// Reads Stryker's JSON report (mutation-testing-report-schema).
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const KILLED = new Set(["Killed", "Timeout"]);
const COUNTED = new Set(["Killed", "Timeout", "Survived", "NoCoverage"]);
const score = (mutants) => {
  const counted = mutants.filter((m) => COUNTED.has(m.status));
  return counted.length === 0 ? 100 : (100 * counted.filter((m) => KILLED.has(m.status)).length) / counted.length;
};

const all = [];
let failed = false;
for (const [file, { mutants }] of Object.entries(report.files)) {
  all.push(...mutants);
  const s = score(mutants);
  const strict = /(^|\/)(money|gst)\.ts$/.test(file);
  const ok = strict ? s === 100 : true;
  console.log(`${ok ? "ok  " : "FAIL"} ${s.toFixed(1).padStart(5)}%  ${file}${strict ? "  (requires 100%)" : ""}`);
  if (!ok) {
    failed = true;
    for (const m of mutants.filter((x) => !KILLED.has(x.status) && COUNTED.has(x.status)))
      console.log(`       survived: line ${m.location.start.line} ${m.mutatorName} -> ${JSON.stringify(m.replacement ?? "")}`);
  }
}
const overall = score(all);
console.log(`overall ${overall.toFixed(1)}% (requires >= 80%)`);
if (overall < 80) failed = true;
process.exit(failed ? 1 : 0);
