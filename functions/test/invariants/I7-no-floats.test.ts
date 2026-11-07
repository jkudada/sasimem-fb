/**
 * Invariant I7 (plan §1): money is an integer number of toea, everywhere. No
 * document the server writes may contain a float. Each step adds the documents it
 * writes to this file.
 */
import { describe, expect, test } from "vitest";
import { makeCreateOrg } from "../../src/callables/createOrg.js";
import { newUser, request, typedOrg } from "../harness/callables.js";
import { floatsUnder } from "../harness/floats.js";
import { adminDb } from "../harness/index.js";
import { anOrgWith } from "../harness/seed.js";
import { approveRun } from "../../src/store/approval.js";
import { draftRun } from "../../src/store/runs.js";
import { parsePeriod } from "@sasimem/core";

describe("I7: no float reaches a document", () => {
  test("in anything createOrg writes", async () => {
    const uid = await newUser();
    const { orgId } = await makeCreateOrg({ now: () => new Date("2026-09-20T01:00:00Z") }).run(request(uid, { ...typedOrg, firstInvoiceNumber: 142 }));
    expect(await floatsUnder(adminDb(), `orgs/${orgId}`)).toEqual([]);
    expect(await floatsUnder(adminDb(), `users/${uid}`)).toEqual([]);
  });

  test("in anything drafting and approval write, GST and a rent edit included", async () => {
    const { orgId } = await anOrgWith({
      org: { gstRegistered: true, gstNumber: "500012345" },
      tenancies: [{ id: "k1", useType: "commercial", rent: 123_457 }, { id: "k2", rent: 99_999, extras: [{ id: "c1", description: "Water", amountToea: 3_333, recurrence: "every", period: null, active: true, gstTreatment: "taxable" } as never] }],
    });
    const OCT = parsePeriod("2026-10");
    const now = new Date("2026-09-28T00:00:00Z");
    await draftRun(orgId, OCT, now);
    await approveRun(orgId, OCT, { actor: "approval-link", now, edits: { rents: { "k1_2026-10": 111_115, "k2_2026-10": 99_999 } as never, included: ["k1_2026-10", "k2_2026-10"] } });
    expect(await floatsUnder(adminDb(), `orgs/${orgId}`)).toEqual([]);
  });
});
