export type Toea = number & { readonly __brand: "Toea" };

export function toea(n: number): Toea {
  if (!Number.isInteger(n)) throw new RangeError(`not a whole number of toea: ${n}`);
  return n as Toea;
}
