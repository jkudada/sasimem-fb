export type Toea = number & { readonly __brand: "Toea" };

export function toea(n: number): Toea {
  if (!Number.isInteger(n)) throw new RangeError(`not a whole number of toea: ${n}`);
  if (!Number.isSafeInteger(n)) throw new RangeError(`toea out of the safe integer range: ${n}`);
  return n as Toea;
}
