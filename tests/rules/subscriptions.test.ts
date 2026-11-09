/** Subscribers' rules (PLAN-SUBSCRIBERS §6; docs/test-lists/subscribers.md, S1 rules). */
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, test } from "vitest";
import { seedOrg, subscriptionDoc, validTenancy, type Seeded } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

/** Write documents with rules off. */
const seed = (docs: Record<string, Record<string, unknown>>) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    for (const [path, data] of Object.entries(docs)) await setDoc(doc(ctx.firestore(), path), data);
  });

const withSubscription = async (s: Seeded, overrides: Record<string, unknown>) =>
  seed({ [`subscriptions/${s.orgId}`]: subscriptionDoc(overrides) });

/** An operator as the console signs in: the claim, and a second factor. */
const operator = () =>
  env.authenticatedContext(`op-${crypto.randomUUID()}`, { operator: true, firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } } as never).firestore();
/** The claim without a second factor: not enough. */
const operatorNoMfa = () =>
  env.authenticatedContext(`op-${crypto.randomUUID()}`, { operator: true }).firestore();

describe("an owner and their subscription", () => {
  test("an owner reads their own subscription and its payments; a stranger reads neither", async () => {
    const s = await seedOrg(env);
    await seed({ [`subscriptions/${s.orgId}/payments/pay1`]: { amountToea: 40_000, receivedOn: "2026-12-01" } });
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    const stranger = env.authenticatedContext("stranger").firestore();
    await assertSucceeds(getDoc(doc(owner, `subscriptions/${s.orgId}`)));
    await assertSucceeds(getDoc(doc(owner, `subscriptions/${s.orgId}/payments/pay1`)));
    await assertFails(getDoc(doc(stranger, `subscriptions/${s.orgId}`)));
    await assertFails(getDoc(doc(stranger, `subscriptions/${s.orgId}/payments/pay1`)));
  });

  test("an owner cannot read the operator's notes about them", async () => {
    const s = await seedOrg(env);
    await seed({ [`subscriptions/${s.orgId}/notes/n1`]: { text: "Called about renewal", by: "op", at: new Date() } });
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    await assertFails(getDoc(doc(owner, `subscriptions/${s.orgId}/notes/n1`)));
  });

  test("an owner cannot raise their own limit, extend their own trial or mark themselves paid", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    const mine = doc(owner, `subscriptions/${s.orgId}`);
    await assertFails(updateDoc(mine, { tenancyLimit: 1000 }));
    await assertFails(updateDoc(mine, { trialEndsOn: "2099-12-31" }));
    await assertFails(updateDoc(mine, { paidThrough: "2099-12-31", status: "active" }));
    await assertFails(deleteDoc(mine));
    await assertFails(addDoc(collection(owner, `subscriptions/${s.orgId}/payments`), { amountToea: 40_000 }));
  });

  test("any signed-in user can read the plans, to show prices; nobody signed out", async () => {
    await seed({ "plans/standard": { name: "Standard", tenancyLimit: 10 } });
    await assertSucceeds(getDoc(doc(env.authenticatedContext("anyone").firestore(), "plans/standard")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "plans/standard")));
  });
});

describe("the tenancy limit", () => {
  test("creating a tenancy below the limit is allowed; at the limit it is refused", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    await withSubscription(s, { activeTenancyCount: 9, tenancyLimit: 10 });
    await assertSucceeds(addDoc(collection(owner, `orgs/${s.orgId}/tenancies`), validTenancy(s)));
    await withSubscription(s, { activeTenancyCount: 10, tenancyLimit: 10 });
    await assertFails(addDoc(collection(owner, `orgs/${s.orgId}/tenancies`), validTenancy(s)));
  });

  test("an org with no subscription cannot create a tenancy (the backfill gives every org one)", async () => {
    const s = await seedOrg(env);
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), `subscriptions/${s.orgId}`)); });
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    await assertFails(addDoc(collection(owner, `orgs/${s.orgId}/tenancies`), validTenancy(s)));
  });

  test("at or over the limit, an existing tenancy can still be edited, ended and (if never invoiced) deleted", async () => {
    const s = await seedOrg(env);
    await seed({ [`orgs/${s.orgId}/tenancies/k1`]: validTenancy(s), [`orgs/${s.orgId}/tenancies/k2`]: validTenancy(s) });
    await withSubscription(s, { activeTenancyCount: 12, tenancyLimit: 10 });
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    await assertSucceeds(updateDoc(doc(owner, `orgs/${s.orgId}/tenancies/k1`), { rentToea: 130_000 }));
    await assertSucceeds(updateDoc(doc(owner, `orgs/${s.orgId}/tenancies/k1`), { endDate: "2026-12-31" }));
    await assertSucceeds(deleteDoc(doc(owner, `orgs/${s.orgId}/tenancies/k2`)));
  });
});

describe("operators (PLAN-SUBSCRIBERS D10)", () => {
  test("an operator with a second factor reads any org, its setup, runs and subscription, and the audit trail", async () => {
    const s = await seedOrg(env);
    await seed({
      [`orgs/${s.orgId}/tenancies/k1`]: validTenancy(s),
      [`orgs/${s.orgId}/runs/2026-10`]: { status: "sent" },
      [`orgs/${s.orgId}/invoices/k1_2026-10`]: { status: "sent" },
      [`orgs/${s.orgId}/emails/e1`]: { kind: "invoice" },
      [`orgs/${s.orgId}/templates/t1`]: { name: "Plain" },
      [`subscriptions/${s.orgId}/notes/n1`]: { text: "note" },
      [`subscriptions/${s.orgId}/payments/pay1`]: { amountToea: 40_000 },
      "operatorEvents/ev1": { kind: "recordPayment", orgId: s.orgId },
      "system/tick": { lastSuccessAt: new Date(), tally: {} },
    });
    const op = operator();
    for (const path of [
      `orgs/${s.orgId}`, `orgs/${s.orgId}/properties/${s.propertyId}`, `orgs/${s.orgId}/tenants/${s.tenantId}`,
      `orgs/${s.orgId}/tenancies/k1`, `orgs/${s.orgId}/runs/2026-10`, `orgs/${s.orgId}/invoices/k1_2026-10`,
      `orgs/${s.orgId}/emails/e1`, `orgs/${s.orgId}/templates/t1`, `subscriptions/${s.orgId}`, `subscriptions/${s.orgId}/notes/n1`,
      `subscriptions/${s.orgId}/payments/pay1`, "operatorEvents/ev1", "system/tick",
    ]) await assertSucceeds(getDoc(doc(op, path)));
    // The Subscribers list reads whole collections.
    await assertSucceeds(getDocs(collection(op, "subscriptions")));
    await assertSucceeds(getDocs(collection(op, "orgs")));
    await assertSucceeds(getDocs(collection(op, `orgs/${s.orgId}/runs`)));
  });

  test("not even an operator reads the invoice counter", async () => {
    const s = await seedOrg(env);
    await assertFails(getDoc(doc(operator(), `orgs/${s.orgId}/private/counter`)));
  });

  test("the operator claim without a second factor reads nothing of anyone else's", async () => {
    const s = await seedOrg(env);
    await seed({ "operatorEvents/ev2": { kind: "x" } });
    const op = operatorNoMfa();
    await assertFails(getDoc(doc(op, `orgs/${s.orgId}`)));
    await assertFails(getDoc(doc(op, `subscriptions/${s.orgId}`)));
    await assertFails(getDoc(doc(op, "operatorEvents/ev2")));
  });

  test("an operator writes nothing directly: every change goes through an audited callable", async () => {
    const s = await seedOrg(env);
    const op = operator();
    await assertFails(updateDoc(doc(op, `subscriptions/${s.orgId}`), { status: "active" }));
    await assertFails(updateDoc(doc(op, `orgs/${s.orgId}`), { name: "Changed" }));
    await assertFails(addDoc(collection(op, `orgs/${s.orgId}/tenants`), { name: "X", email: "x@x.example", phone: "" }));
    await assertFails(setDoc(doc(op, "operatorEvents/forged"), { kind: "x" }));
    await assertFails(setDoc(doc(op, "plans/standard"), { tenancyLimit: 99 }));
  });

  test("an owner cannot read the audit trail or the tick's heartbeat, or list other orgs", async () => {
    const s = await seedOrg(env);
    await seed({ "operatorEvents/ev3": { kind: "x", orgId: s.orgId }, "system/tick": { lastSuccessAt: new Date(), tally: {} } });
    const owner = env.authenticatedContext(s.ownerUid).firestore();
    await assertFails(getDoc(doc(owner, "operatorEvents/ev3")));
    await assertFails(getDoc(doc(owner, "system/tick")));
    await assertFails(getDocs(collection(owner, "orgs")));
  });
});
