/** Staff roles in the rules (docs/PLAN-ADMIN-DASHBOARD.md §4-§5, A1; docs/test-lists/admin-dashboard.md). */
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { seedOrg, staffDb, validTenancy, WITH_CODE, type Seeded } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const seed = (docs: Record<string, Record<string, unknown>>) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    for (const [path, data] of Object.entries(docs)) await setDoc(doc(ctx.firestore(), path), data);
  });
const setting = (o: Record<string, unknown>) => seed({ "console/settings": o });

const ROLES = ["owner", "manager", "supervisor", "support", "viewer"] as const;
type Role = (typeof ROLES)[number];

/** One org with something in every place staff might look. */
async function world(): Promise<Seeded> {
  const s = await seedOrg(env);
  await seed({
    [`orgs/${s.orgId}/tenancies/k1`]: validTenancy(s),
    [`orgs/${s.orgId}/runs/2026-10`]: { status: "sent", invoiceCount: 1 },
    [`orgs/${s.orgId}/invoices/k1_2026-10`]: { status: "sent" },
    [`orgs/${s.orgId}/emails/e1`]: { kind: "invoice" },
    [`orgs/${s.orgId}/templates/t1`]: { name: "Plain" },
    [`subscriptions/${s.orgId}/notes/n1`]: { text: "note" },
    [`subscriptions/${s.orgId}/payments/pay1`]: { amountToea: 40_000 },
    "system/tick": { lastSuccessAt: new Date(), tally: {} },
    "signupInvites/ann@wari.example": { invitedAt: new Date() },
  });
  return s;
}

/** Which of these paths `role` may read. */
async function readable(role: Role, paths: Record<string, string>): Promise<string[]> {
  const { db } = await staffDb(env, role);
  const ok: string[] = [];
  for (const [name, path] of Object.entries(paths)) {
    try {
      await getDoc(doc(db, path));
      ok.push(name);
    } catch { /* refused */ }
  }
  return ok;
}

describe("what each role reads (§4)", () => {
  test("customers' records are the Owner's alone until A2's view-as; subscriptions all but Viewers'; payments billing roles'", async () => {
    await setting({ managersSeeNames: false });
    const s = await world();
    const o = `orgs/${s.orgId}`;
    const paths = {
      profile: o, property: `${o}/properties/${s.propertyId}`, tenant: `${o}/tenants/${s.tenantId}`, tenancy: `${o}/tenancies/k1`,
      run: `${o}/runs/2026-10`, invoice: `${o}/invoices/k1_2026-10`, email: `${o}/emails/e1`, template: `${o}/templates/t1`,
      counter: `${o}/private/counter`,
      subscription: `subscriptions/${s.orgId}`, payment: `subscriptions/${s.orgId}/payments/pay1`, note: `subscriptions/${s.orgId}/notes/n1`,
      invite: "signupInvites/ann@wari.example", health: "system/tick", settings: "console/settings",
    };
    const records = ["property", "tenant", "tenancy", "run", "invoice", "email", "template"];
    const got = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await readable(r, paths)] as const)));
    expect(got).toEqual({
      owner: ["profile", ...records, "subscription", "payment", "note", "invite", "health", "settings"],
      manager: ["subscription", "payment", "note", "invite", "health", "settings"],
      supervisor: ["profile", "subscription", "payment", "note", "invite", "health", "settings"],
      support: ["profile", "subscription", "note", "invite", "health", "settings"],
      viewer: ["health", "settings"],
    });
  });

  test("Managers see customers' names while the Owner allows it (S1), and lose them when it is turned off", async () => {
    const s = await world();
    const { db } = await staffDb(env, "manager");
    await setting({ managersSeeNames: true });
    await assertSucceeds(getDoc(doc(db, `orgs/${s.orgId}`)));
    await assertSucceeds(getDocs(collection(db, "orgs")));
    await assertFails(getDoc(doc(db, `orgs/${s.orgId}/tenants/${s.tenantId}`)));
    await setting({ managersSeeNames: false });
    await assertFails(getDoc(doc(db, `orgs/${s.orgId}`)));
    await assertFails(getDocs(collection(db, "orgs")));
  });

  test("the Subscribers list's whole-collection reads work for the roles that have them", async () => {
    await world();
    for (const r of ["owner", "supervisor", "support"] as const) {
      const { db } = await staffDb(env, r);
      await assertSucceeds(getDocs(collection(db, "orgs")));
      await assertSucceeds(getDocs(collection(db, "subscriptions")));
    }
    const viewer = (await staffDb(env, "viewer")).db;
    await assertFails(getDocs(collection(viewer, "subscriptions")));
  });

  test("a suspended or removed member, one signed in without the code, and the old operator claim alone read nothing", async () => {
    const s = await world();
    const suspended = (await staffDb(env, "owner", { status: "suspended" })).db;
    const removed = (await staffDb(env, "owner", { status: "removed" })).db;
    const noCode = (await staffDb(env, "owner", { code: false })).db;
    const oldClaim = env.authenticatedContext("old-op", { operator: true, staffRole: "owner", ...WITH_CODE } as never).firestore();
    for (const db of [suspended, removed, noCode, oldClaim]) {
      for (const path of [`orgs/${s.orgId}`, `subscriptions/${s.orgId}`, "system/tick", "console/settings", "signupInvites/ann@wari.example"]) {
        await assertFails(getDoc(doc(db, path)));
      }
    }
  });

  test("suspending takes effect on the very next read: the rules read the staff document, not the token", async () => {
    const s = await world();
    const { uid, db } = await staffDb(env, "supervisor");
    await assertSucceeds(getDoc(doc(db, `subscriptions/${s.orgId}`)));
    await seed({ [`staff/${uid}`]: { role: "supervisor", status: "suspended" } });
    await assertFails(getDoc(doc(db, `subscriptions/${s.orgId}`)));
  });

  test("no role writes customers' data, subscriptions, the audit trail, settings or staff records directly", async () => {
    const s = await world();
    const other = await staffDb(env, "viewer");
    for (const r of ROLES) {
      const { db } = await staffDb(env, r);
      await assertFails(updateDoc(doc(db, `subscriptions/${s.orgId}`), { status: "active" }));
      await assertFails(updateDoc(doc(db, `orgs/${s.orgId}`), { name: "Changed" }));
      await assertFails(setDoc(doc(db, "operatorEvents/forged"), { kind: "x" }));
      await assertFails(setDoc(doc(db, "console/settings"), { viewAsEnabled: true }));
      await assertFails(setDoc(doc(db, `staff/new-${r}`), { role: "owner", status: "active" }));
      await assertFails(updateDoc(doc(db, `staff/${other.uid}`), { role: "owner" }));
    }
  });
});

describe("the audit trail (§4)", () => {
  test("Owners and Managers read all; Supervisors their team's and their own; Support their own; Viewers none", async () => {
    const sup = await staffDb(env, "supervisor");
    const help = await staffDb(env, "support");
    await seed({
      "operatorEvents/byOwner": { kind: "changePlan", actor: "o1", actorRole: "owner" },
      "operatorEvents/bySupport": { kind: "addNote", actor: help.uid, actorRole: "support" },
      "operatorEvents/byOtherSupport": { kind: "addNote", actor: "s9", actorRole: "support" },
      "operatorEvents/bySupervisorLegacy": { kind: "addNote", actor: sup.uid },
      "operatorEvents/byTick": { kind: "statusChange", actor: "subscription-tick" },
    });
    const ids = ["byOwner", "bySupport", "byOtherSupport", "bySupervisorLegacy", "byTick"];
    const reads = async (db: ReturnType<typeof env.authenticatedContext>["firestore"] extends () => infer F ? F : never) => {
      const ok: string[] = [];
      for (const id of ids) {
        try { await getDoc(doc(db, `operatorEvents/${id}`)); ok.push(id); } catch { /* refused */ }
      }
      return ok;
    };
    expect(await reads((await staffDb(env, "owner")).db)).toEqual(ids);
    expect(await reads((await staffDb(env, "manager")).db)).toEqual(ids);
    expect(await reads(sup.db)).toEqual(["bySupport", "byOtherSupport", "bySupervisorLegacy"]);
    expect(await reads(help.db)).toEqual(["bySupport"]);
    expect(await reads((await staffDb(env, "viewer")).db)).toEqual([]);
  });

  test("the Audit log's queries: Supervisors ask for their team's roles, Support for their own uid", async () => {
    const sup = await staffDb(env, "supervisor");
    const help = await staffDb(env, "support");
    await assertSucceeds(getDocs(query(collection(sup.db, "operatorEvents"), where("actorRole", "in", ["supervisor", "support"]))));
    await assertSucceeds(getDocs(query(collection(help.db, "operatorEvents"), where("actor", "==", help.uid))));
    await assertFails(getDocs(collection(sup.db, "operatorEvents")));
    await assertFails(getDocs(query(collection(help.db, "operatorEvents"), where("actorRole", "in", ["supervisor", "support"]))));
  });
});

describe("staff records (§9)", () => {
  test("Owners and Managers list staff; everyone else reads only their own", async () => {
    const viewer = await staffDb(env, "viewer");
    const support = await staffDb(env, "support");
    for (const r of ["owner", "manager"] as const) await assertSucceeds(getDocs(collection((await staffDb(env, r)).db, "staff")));
    await assertSucceeds(getDoc(doc(viewer.db, `staff/${viewer.uid}`)));
    await assertFails(getDoc(doc(viewer.db, `staff/${support.uid}`)));
    await assertFails(getDocs(collection(support.db, "staff")));
    const landlord = env.authenticatedContext("landlord").firestore();
    await assertFails(getDoc(doc(landlord, `staff/${viewer.uid}`)));
  });

  test("each person sets their own name and when they were last seen, and nothing else", async () => {
    const me = await staffDb(env, "viewer");
    const mine = doc(me.db, `staff/${me.uid}`);
    await assertSucceeds(updateDoc(mine, { lastSeenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(mine, { displayName: "Ann Kila", lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(mine, { displayName: "Ann", lastSeenAt: new Date("2020-01-01") }));
    await assertFails(updateDoc(mine, { displayName: "", lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(mine, { displayName: "x".repeat(81), lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(mine, { role: "owner", lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(mine, { status: "suspended", lastSeenAt: serverTimestamp() }));
    await assertFails(deleteDoc(mine));
    const suspended = await staffDb(env, "viewer", { status: "suspended" });
    await assertFails(updateDoc(doc(suspended.db, `staff/${suspended.uid}`), { lastSeenAt: serverTimestamp() }));
  });
});
