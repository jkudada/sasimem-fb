/** Reading what a landlord typed. Rules about the values live in core. */
import { type Toea, amountProblem, parseKina } from "@sasimem/core";

const AMOUNT_PROBLEM = "Enter an amount like K1,200.00.";

/** An amount in kina as typed ("K1,200.50", "-K20"); a plain-English problem if it is not one. */
export function readKina(text: string): { toea: Toea } | { problem: string } {
  try {
    const toea = parseKina(text);
    const problem = amountProblem(toea);
    return problem === null ? { toea } : { problem };
  } catch {
    return { problem: AMOUNT_PROBLEM };
  }
}

/** A whole number as typed, or NaN, which core's checks report in their own words. */
export const whole = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);

/** Prefix each problem's key, so one form can show problems from several of core's checks. */
export function prefix(pre: string, problems: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(problems).map(([k, v]) => [pre + k, v]));
}
