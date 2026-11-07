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

describe("I7: no float reaches a document", () => {
  test("in anything createOrg writes", async () => {
    const uid = await newUser();
    const { orgId } = await makeCreateOrg({ now: () => new Date("2026-09-20T01:00:00Z") }).run(request(uid, { ...typedOrg, firstInvoiceNumber: 142 }));
    expect(await floatsUnder(adminDb(), `orgs/${orgId}`)).toEqual([]);
    expect(await floatsUnder(adminDb(), `users/${uid}`)).toEqual([]);
  });
});
