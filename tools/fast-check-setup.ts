import fc from "fast-check";

// PRs run ~200 runs per property; the nightly job sets FC_NUM_RUNS=10000.
// The seed is always logged so any failure can be replayed exactly.
const numRuns = Number(process.env["FC_NUM_RUNS"] ?? 200);
const seed = Number(process.env["FC_SEED"] ?? Date.now() % 2 ** 31);
fc.configureGlobal({ numRuns, seed });
console.log(`fast-check: numRuns=${numRuns} seed=${seed} (replay with FC_SEED=${seed})`);
