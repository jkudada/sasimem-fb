import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import { makeCreateOrg } from "../src/callables/createOrg.js";
import { newUser, request, typedOrg } from "./harness/callables.js";
import { adminDb } from "./harness/index.js";

const now = new Date("2026-09-20T01:00:00Z");
const createOrg = makeCreateOrg({ now: () => now });

describe("createOrg", () => {
  test("creates the organisation with the plan's defaults, its owner, the user's org list and the custom claim", async () => {
    const uid = await newUser();
    const { orgId } = await createOrg.run(request(uid, typedOrg));

    const org = await adminDb().doc(`orgs/${orgId}`).get();
    expect(org.data()).toEqual({
      ...typedOrg,
      invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby", approvalLeadDays: 3, sendHour: 8,
      reminderAfterDays: 7, reminderMode: "auto", createdAt: Timestamp.fromDate(now),
    });
    expect((await adminDb().doc(`orgs/${orgId}/members/${uid}`).get()).data()).toEqual({ role: "owner", addedAt: Timestamp.fromDate(now) });
    expect((await adminDb().doc(`users/${uid}`).get()).data()).toEqual({ orgIds: [orgId] });
    expect((await getAuth().getUser(uid)).customClaims).toEqual({ orgIds: [orgId] });
  });

  test("refuses a caller who is not signed in", async () => {
    await expect(createOrg.run(request(null, typedOrg))).rejects.toMatchObject({ code: "unauthenticated", message: "Sign in first." });
  });

  test("seeds the server-only counter from the first invoice number, 1 unless the landlord says otherwise", async () => {
    const fresh = await createOrg.run(request(await newUser(), typedOrg));
    expect((await adminDb().doc(`orgs/${fresh.orgId}/private/counter`).get()).data()).toEqual({ nextInvoiceNumber: 1 });
    const continuing = await createOrg.run(request(await newUser(), { ...typedOrg, firstInvoiceNumber: 142 }));
    expect((await adminDb().doc(`orgs/${continuing.orgId}/private/counter`).get()).data()).toEqual({ nextInvoiceNumber: 142 });
  });
});
