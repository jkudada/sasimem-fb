// G2a (docs/test-lists/general-g2.md): the price list, one-off drafts, default terms.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { MAX_LINES, TAX_CODES } from "../../packages/core/src/oneoff.js";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const item = { name: "Labour", description: "Qualified electrician", unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };
const line = { description: "Labour", detail: "", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };
const draft = { customerId: "t1", lines: [line], poNumber: "", notes: "", dueDays: null };

async function setup() {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  const org = `orgs/${s.orgId}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `${org}/members/viewer`), { role: "member", addedAt: new Date() });
  });
  return { s, org, owner, member: env.authenticatedContext("viewer").firestore(), stranger: env.authenticatedContext("stranger").firestore() };
}

test("an owner creates, updates and deletes items and drafts; a member only reads; a stranger nothing", async () => {
  const { org, owner, member, stranger } = await setup();
  for (const [name, data] of [["items", item], ["drafts", draft]] as const) {
    const ref = await assertSucceeds(addDoc(collection(owner, `${org}/${name}`), data));
    await assertSucceeds(updateDoc(ref, name === "items" ? { unitPriceToea: 9_000 } : { notes: "Thanks" }));
    await assertSucceeds(getDoc(doc(member, ref.path)));
    await assertFails(addDoc(collection(member, `${org}/${name}`), data));
    await assertFails(getDoc(doc(stranger, ref.path)));
    await assertFails(deleteDoc(doc(stranger, ref.path)));
    await assertSucceeds(deleteDoc(ref));
  }
});

test("every tax code core offers is accepted, and a draft may hold the most lines core allows", async () => {
  const { org, owner } = await setup();
  for (const taxCode of TAX_CODES) await assertSucceeds(addDoc(collection(owner, `${org}/items`), { ...item, taxCode }));
  await assertSucceeds(addDoc(collection(owner, `${org}/drafts`), { ...draft, lines: Array.from({ length: MAX_LINES }, () => line) }));
  await assertFails(addDoc(collection(owner, `${org}/drafts`), { ...draft, lines: Array.from({ length: MAX_LINES + 1 }, () => line) }));
});

test("a draft being written may be incomplete: no customer yet, no lines yet", async () => {
  const { org, owner } = await setup();
  await assertSucceeds(addDoc(collection(owner, `${org}/drafts`), { ...draft, customerId: "", lines: [] }));
});

test("bad items are refused", async () => {
  const { org, owner } = await setup();
  for (const bad of [{ name: "" }, { name: "x".repeat(101) }, { description: "x".repeat(201) }, { unit: "x".repeat(13) },
    { unitPriceToea: 80.5 }, { unitPriceToea: 1_000_000_001 }, { taxCode: "luxury" }, { colour: "red" }]) {
    await assertFails(addDoc(collection(owner, `${org}/items`), { ...item, ...bad }));
  }
});

test("bad drafts are refused; a bad line waits for issuing to be refused", async () => {
  const { org, owner } = await setup();
  const drafts = collection(owner, `${org}/drafts`);
  for (const bad of [{ poNumber: "x".repeat(41) }, { notes: "x".repeat(501) }, { dueDays: 91 }, { dueDays: 1.5 }, { lines: "none" },
    { customerId: 7 }, { status: "sent" }]) {
    await assertFails(addDoc(drafts, { ...draft, ...bad }));
  }
  // A line's fields are checked when the draft is issued (core, in issueInvoice), not here:
  // 30 lines field by field passes the rules engine's 1,000-expression limit. T3 covers the refusal.
  await assertSucceeds(addDoc(drafts, { ...draft, lines: [line, { ...line, quantityMilli: 0 }] }));
});

test("no one writes an invoice directly, a one-off included (I9)", async () => {
  const { org, owner } = await setup();
  await assertFails(setDoc(doc(owner, `${org}/invoices/d1`), { status: "sent", source: { kind: "oneOff", draftId: "d1" } }));
});

test("the owner cannot switch on features or modules", async () => {
  const { org, owner } = await setup();
  await assertFails(updateDoc(doc(owner, org), { features: { oneOff: true } }));
  await assertFails(updateDoc(doc(owner, org), { modules: ["trades"] }));
});

test("the default payment terms are an owner-editable profile field, 0-90 days", async () => {
  const { org, owner } = await setup();
  await assertSucceeds(updateDoc(doc(owner, org), { defaultTermsDays: 30 }));
  await assertSucceeds(updateDoc(doc(owner, org), { defaultTermsDays: 0 }));
  await assertFails(updateDoc(doc(owner, org), { defaultTermsDays: 91 }));
  await assertFails(updateDoc(doc(owner, org), { defaultTermsDays: 7.5 }));
});

test("G2d: the sent-as-scheduled note is an owner-editable switch", async () => {
  const { org, owner } = await setup();
  await assertSucceeds(updateDoc(doc(owner, org), { scheduledSentNote: false }));
  await assertSucceeds(updateDoc(doc(owner, org), { scheduledSentNote: true }));
  await assertFails(updateDoc(doc(owner, org), { scheduledSentNote: "no" }));
});
