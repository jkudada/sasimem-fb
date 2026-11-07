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
});
