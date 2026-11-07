/**
 * Money (plan §3.1). Every amount is an integer number of toea; 1 kina = 100 toea.
 * Amounts are parsed with string arithmetic, never floats: 1.005 * 100 is 100.49999.
 */
export type Toea = number & { readonly __brand: "Toea" };

export const TOEA_PER_KINA = 100;

/** The only way to make a Toea. Throws on a fraction or an unsafe integer. */
export function toea(n: number): Toea {
  // isSafeInteger rejects fractions too: beyond 2^53 integers stop being exact.
  if (!Number.isSafeInteger(n)) throw new RangeError(`not a whole, safe number of toea: ${n}`);
  return n as Toea;
}

/** Read an amount the way a landlord types it. */
export function parseKina(text: string): Toea {
  const cleaned = text.replace(/[K,\s]/g, "");
  // An optional minus, digits, an optional point and digits; at least one digit somewhere.
  const match = /^(-?)(?=\.?\d)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null) throw new SyntaxError(`not an amount: ${JSON.stringify(text)}`);
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]); // "" (as in ".75") is 0
  const digits = match[3] ?? "";
  const fraction = Number((digits + "00").slice(0, 2));
  const roundUp = digits.charAt(2) >= "5" ? 1 : 0;
  // Round the magnitude, then apply the sign: half away from zero, as Decimal does.
  return toea(sign * (whole * TOEA_PER_KINA + fraction + roundUp));
}

/** K1,200.50 - thousands commas, always two places of toea. */
export function formatKina(amount: Toea): string {
  const sign = amount < 0 ? "-" : "";
  const magnitude = Math.abs(amount);
  const kina = Math.trunc(magnitude / TOEA_PER_KINA);
  const cents = magnitude % TOEA_PER_KINA;
  return `${sign}K${groupThousands(kina)}.${String(cents).padStart(2, "0")}`;
}

// Grouped by hand rather than with toLocaleString, so the output never depends
// on the ICU data a browser or Node build happens to ship.
function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** K10,000,000.00 - the largest amount a landlord may type (plan §3.1). */
export const MAX_EDITABLE_TOEA = 1_000_000_000;

/** A plain-English problem with an amount the landlord typed, or null. Not an error. */
export function amountProblem(amount: Toea): string | null {
  if (Math.abs(amount) > MAX_EDITABLE_TOEA) {
    return `That is more than ${formatKina(toea(MAX_EDITABLE_TOEA))}. Check the amount.`;
  }
  return null;
}
