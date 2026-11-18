/**
 * The time limit for a test that races two transactions on the same documents (two taps,
 * two overlapping ticks). Every other T3 test keeps Vitest's 5 s.
 *
 * A race is slow on the emulator, and that is not our code. Measured 2026-11-18, 40
 * races of claimReminder took 2.7-4.0 s each: both transactions read, the emulator holds
 * both commits about 2 s before it aborts one, then firebase-admin waits about 1 s
 * before it retries the loser, which then reads the winner's write and backs off. A
 * test with a race or two, plus its setup, ran 2.3-5.0 s, so on a slower CI runner it
 * timed out now and then (nightly flake detector: I4, I6 and I8, four nights of ten).
 *
 * 20 s is four times the slowest seen. A real deadlock still fails: it never finishes.
 */
export const RACE_TIMEOUT_MS = 20_000;
