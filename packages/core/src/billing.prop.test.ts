import fc from "fast-check";
import { expect, test } from "vitest";
import { aCharge, aTenancy, anOrg } from "../testing/index.js";
import { draftInvoice } from "./billing.js";
import { gstOn } from "./gst.js";
import { MAX_EDITABLE_TOEA, formatKina, toea } from "./money.js";
import { parsePeriod } from "./period.js";
import type { GstTreatment } from "./types.js";

const kina = fc.integer({ min: -MAX_EDITABLE_TOEA, max: MAX_EDITABLE_TOEA }).map((n) => formatKina(toea(n)));
const charge = fc.record({ amount: kina, treatment: fc.constantFrom<GstTreatment>("inherit", "taxable", "exempt") });

test("for any rent and charges, total = subtotal + GST, each the sum of its lines", () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), fc.integer({ min: 0, max: MAX_EDITABLE_TOEA }), fc.array(charge, { maxLength: 8 }),
      (registered, commercial, rent, charges) => {
        let t = aTenancy().withRent(formatKina(toea(rent)));
        if (commercial) t = t.commercial();
        for (const c of charges) t = t.withCharge(aCharge().amount(c.amount).treatment(c.treatment).build());
        const org = registered ? anOrg().gstRegistered().build() : anOrg().build();
        const inv = draftInvoice({ org, tenancy: t.build(), period: parsePeriod("2026-10") });

        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        expect(inv.subtotalToea).toBe(sum(inv.lines.map((l) => l.amountToea)));
        expect(inv.gstToea).toBe(sum(inv.lines.map((l) => l.gstToea)));
        expect(inv.totalToea).toBe(inv.subtotalToea + inv.gstToea);
        for (const l of inv.lines) expect(l.gstToea).toBe(l.gstApplicable ? gstOn(l.amountToea) : 0);
      }),
  );
});
