import fc from "fast-check";
import { expect, test } from "vitest";
import { MAX_EDITABLE_TOEA, formatKina, parseKina, toea } from "./money.js";

const editableToea = fc.integer({ min: -MAX_EDITABLE_TOEA, max: MAX_EDITABLE_TOEA }).map(toea);

test("every editable amount survives formatKina then parseKina unchanged", () => {
  fc.assert(fc.property(editableToea, (amount) => parseKina(formatKina(amount).replace("-K", "-")) === amount));
});

// An independent oracle in BigInt: scale the decimal string to 10^-6 kina exactly,
// then round half away from zero to the toea.
function oracle(sign: string, whole: string, fraction: string): number {
  const micro = BigInt(whole || "0") * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  const toeaUnits = (micro + 5_000n) / 10_000n;
  return Number(sign === "-" ? -toeaUnits : toeaUnits);
}

test("parseKina agrees with exact integer arithmetic for any decimal up to six places", () => {
  const digits = (max: number) => fc.string({ unit: fc.constantFrom(..."0123456789"), minLength: 1, maxLength: max });
  fc.assert(
    fc.property(fc.constantFrom("", "-"), digits(7), digits(6), (sign, whole, fraction) => {
      expect(parseKina(`${sign}${whole}.${fraction}`)).toBe(oracle(sign, whole, fraction));
    }),
  );
});
