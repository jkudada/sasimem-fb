import { describe, expect, test } from "vitest";
import { makeCreateOrg } from "../src/callables/createOrg.js";
import { getNumbering, setNextInvoiceNumber } from "../src/callables/numbering.js";
import { newUser, request, typedOrg } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";

const createOrg = makeCreateOrg({ now: () => new Date("2026-09-20T01:00:00Z") });

async function anOrg() {
  const uid = await newUser();
  const { orgId } = await createOrg.run(request(uid, { ...typedOrg, firstInvoiceNumber: 5 }));
  return { uid, orgId };
}

describe("where invoice numbering starts (plan §4, A3)", () => {
  test("an owner sees the next number, and that numbering has not started", async () => {
    const { uid, orgId } = await anOrg();
    expect(await getNumbering.run(request(uid, { orgId }))).toEqual({ next: 5, started: false });
  });

  test("an owner can change it before any number is issued", async () => {
    const { uid, orgId } = await anOrg();
    await setNextInvoiceNumber.run(request(uid, { orgId, next: 142 }));
    expect((await adminDb().doc(`orgs/${orgId}/private/counter`).get()).data()).toEqual({ nextInvoiceNumber: 142 });
  });

  test("once a number has been issued, it is fixed, and says why", async () => {
    const { uid, orgId } = await anOrg();
    await adminDb().doc(`orgs/${orgId}/issuedNumbers/5`).set({ invoiceId: "k1_2026-10", at: new Date() });
    expect(await getNumbering.run(request(uid, { orgId }))).toMatchObject({ started: true });
    await expect(setNextInvoiceNumber.run(request(uid, { orgId, next: 142 }))).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Invoices have already been numbered, so the next number cannot be changed.",
    });
    expect((await adminDb().doc(`orgs/${orgId}/private/counter`).get()).get("nextInvoiceNumber")).toBe(5);
  });

  test("refused for someone who is not an owner of the organisation", async () => {
    const { orgId } = await anOrg();
    const stranger = await newUser();
    await expect(setNextInvoiceNumber.run(request(stranger, { orgId, next: 142 }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getNumbering.run(request(stranger, { orgId }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getNumbering.run(request(null, { orgId }))).rejects.toMatchObject({ code: "unauthenticated" });
  });

  test("refuses a number below 1 or not whole, in core's words", async () => {
    const { uid, orgId } = await anOrg();
    for (const next of [0, 1.5, "142" as unknown as number]) {
      await expect(setNextInvoiceNumber.run(request(uid, { orgId, next }))).rejects.toMatchObject({
        code: "invalid-argument",
        message: "Enter the number your next invoice should have, such as 1 or 142.",
      });
    }
  });
});
