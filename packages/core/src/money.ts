export type Toea = number & { readonly __brand: "Toea" };

export function toea(n: number): Toea {
  return n as Toea;
}
