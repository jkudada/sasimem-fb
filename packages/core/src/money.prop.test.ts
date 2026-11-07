import fc from "fast-check";
import { test } from "vitest";
import { MAX_EDITABLE_TOEA, formatKina, parseKina, toea } from "./money.js";

const editableToea = fc.integer({ min: -MAX_EDITABLE_TOEA, max: MAX_EDITABLE_TOEA }).map(toea);

test("every editable amount survives formatKina then parseKina unchanged", () => {
  fc.assert(fc.property(editableToea, (amount) => parseKina(formatKina(amount).replace("-K", "-")) === amount));
});
