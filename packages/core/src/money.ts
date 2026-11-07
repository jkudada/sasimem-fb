/**
 * Money (plan §3.1). Every amount is an integer number of toea; 1 kina = 100 toea.
 * Amounts are parsed with string arithmetic, never floats: 1.005 * 100 is 100.49999.
 */
export type Toea = number & { readonly __brand: "Toea" };

export const TOEA_PER_KINA = 100;

/** The only way to make a Toea. Throws on a fraction or an unsafe integer. */
export function toea(n: number): Toea {
  if (!Number.isInteger(n)) throw new RangeError(`not a whole number of toea: ${n}`);
  if (!Number.isSafeInteger(n)) throw new RangeError(`toea out of the safe integer range: ${n}`);
  return n as Toea;
}

/** Read an amount the way a landlord types it. */
export function parseKina(text: string): Toea {
  const cleaned = text.replace(/[K,\s]/g, "");
  if (cleaned === "") throw new SyntaxError("empty amount");
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null) return toea(0);
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2] || "0");
  const digits = match[3] ?? "";
  const fraction = Number((digits + "00").slice(0, 2));
  const roundUp = (digits[2] ?? "0") >= "5" ? 1 : 0;
  // Round the magnitude, then apply the sign: half away from zero, as Decimal does.
  return toea(sign * (whole * TOEA_PER_KINA + fraction + roundUp));
}
