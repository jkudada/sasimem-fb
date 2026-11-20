// G2q-a and G2q-c (docs/test-lists/general-g2q.md): quote drafts, sent quotes, their links, the org's quote settings.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, test } from "vitest";
import { DEFAULT_QUOTE_TERMS, QUOTE_TERMS_MAX } from "../../packages/core/src/quotes.js";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const line = { description: "Labour", detail: "", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" };
const draft = { customerId: "t1", lines: [line], notes: "", validDays: null };

async function setup() {
  const s = await seedOrg(env);
  const owner = env.authenticatedContext(s.ownerUid).firestore();
  const org = `orgs/${s.orgId}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `${org}/members/viewer`), { role: "member", addedAt: new Date() });
    await setDoc(doc(db, `${org}/quotes/q1`), { number: "QUO-0001", revision: 1, status: "sent" });
    await setDoc(doc(db, "quoteTokens/abc"), { orgId: s.orgId, quoteId: "q1", revision: 1 });
    await setDoc(doc(db, `${org}/quotes/q1/revisions/1`), { number: "QUO-0001", revision: 1, status: "sent" });
    await setDoc(doc(db, `${org}/drafts/q1_r1_full`), { customerId: "t1", lines: [line], poNumber: "PO-1", notes: "Quote QUO-0001", dueDays: null });
  });
  return { s, org, owner, member: env.authenticatedContext("viewer").firestore(), stranger: env.authenticatedContext("stranger").firestore() };
}

test("the owner creates, edits and deletes quote drafts; a member only reads; a stranger nothing", async () => {
  const { org, owner, member, stranger } = await setup();
  const ref = await assertSucceeds(addDoc(collection(owner, `${org}/quoteDrafts`), draft));
  await assertSucceeds(updateDoc(ref, { notes: "Includes parts", validDays: 14 }));
  await assertSucceeds(getDoc(doc(member, ref.path)));
  await assertFails(addDoc(collection(member, `${org}/quoteDrafts`), draft));
  await assertFails(updateDoc(doc(member, ref.path), { notes: "x" }));
  await assertFails(getDoc(doc(stranger, ref.path)));
  await assertFails(deleteDoc(doc(member, ref.path)));
  await assertSucceeds(deleteDoc(ref));
});

test("a quote draft's shape: exact keys, up to 30 lines, notes up to 500, valid days 1-365 or none", async () => {
  const { org, owner } = await setup();
  const drafts = collection(owner, `${org}/quoteDrafts`);
  await assertSucceeds(addDoc(drafts, { ...draft, lines: Array(30).fill(line), validDays: 365 }));
  await assertSucceeds(addDoc(drafts, { ...draft, customerId: "", lines: [] })); // unfinished is fine
  await assertFails(addDoc(drafts, { ...draft, lines: Array(31).fill(line) }));
  await assertFails(addDoc(drafts, { ...draft, notes: "x".repeat(501) }));
  await assertFails(addDoc(drafts, { ...draft, validDays: 0 }));
  await assertFails(addDoc(drafts, { ...draft, validDays: 366 }));
  await assertFails(addDoc(drafts, { ...draft, poNumber: "" }));
  await assertFails(addDoc(drafts, { ...draft, number: "QUO-0001" }));
  const { validDays: _, ...noDays } = draft;
  await assertFails(addDoc(drafts, noDays));
});

test("members read sent quotes; nobody writes them; nobody reads or writes quote links", async () => {
  const { org, owner, member, stranger } = await setup();
  await assertSucceeds(getDoc(doc(member, `${org}/quotes/q1`)));
  await assertFails(getDoc(doc(stranger, `${org}/quotes/q1`)));
  await assertFails(updateDoc(doc(owner, `${org}/quotes/q1`), { status: "accepted" }));
  await assertFails(setDoc(doc(owner, `${org}/quotes/q2`), { number: "QUO-0002" }));
  await assertFails(deleteDoc(doc(owner, `${org}/quotes/q1`)));
  await assertFails(getDoc(doc(owner, "quoteTokens/abc")));
  await assertFails(setDoc(doc(owner, "quoteTokens/def"), { orgId: "x" }));
});

test("the owner sets how long quotes are valid (1-365) and the quote terms (up to 2,000 characters)", async () => {
  const { org, owner, member } = await setup();
  await assertSucceeds(updateDoc(doc(owner, org), { quoteValidDays: 14, quoteTerms: DEFAULT_QUOTE_TERMS }));
  await assertSucceeds(updateDoc(doc(owner, org), { quoteTerms: "" }));
  await assertSucceeds(updateDoc(doc(owner, org), { quoteTerms: "x".repeat(QUOTE_TERMS_MAX) }));
  await assertFails(updateDoc(doc(owner, org), { quoteTerms: "x".repeat(QUOTE_TERMS_MAX + 1) }));
  await assertFails(updateDoc(doc(owner, org), { quoteValidDays: 0 }));
  await assertFails(updateDoc(doc(owner, org), { quoteValidDays: 366 }));
  await assertFails(updateDoc(doc(owner, org), { quoteValidDays: 7.5 }));
  await assertFails(updateDoc(doc(member, org), { quoteValidDays: 14 }));
});

test("G2q-c: a revision draft names the quote it revises (a string); new drafts need not", async () => {
  const { org, owner } = await setup();
  const drafts = collection(owner, `${org}/quoteDrafts`);
  await assertSucceeds(setDoc(doc(drafts, "q1_rev"), { ...draft, revises: "q1" }));
  await assertSucceeds(updateDoc(doc(drafts, "q1_rev"), { notes: "Second floor too" }));
  await assertFails(addDoc(drafts, { ...draft, revises: 1 }));
  await assertFails(addDoc(drafts, { ...draft, revises: "" }));
  await assertFails(addDoc(drafts, { ...draft, revises: "x".repeat(129) }));
});

test("G2q-c: members read a quote's earlier revisions; nobody writes them", async () => {
  const { org, owner, member, stranger } = await setup();
  await assertSucceeds(getDoc(doc(member, `${org}/quotes/q1/revisions/1`)));
  await assertFails(getDoc(doc(stranger, `${org}/quotes/q1/revisions/1`)));
  await assertFails(setDoc(doc(owner, `${org}/quotes/q1/revisions/2`), { revision: 2 }));
  await assertFails(updateDoc(doc(owner, `${org}/quotes/q1/revisions/1`), { status: "accepted" }));
  await assertFails(deleteDoc(doc(owner, `${org}/quotes/q1/revisions/1`)));
});

test("G2q-c: the owner edits and deletes an invoice draft made from a quote, as any draft", async () => {
  const { org, owner, member } = await setup();
  await assertSucceeds(updateDoc(doc(owner, `${org}/drafts/q1_r1_full`), { dueDays: 7 }));
  await assertFails(updateDoc(doc(member, `${org}/drafts/q1_r1_full`), { dueDays: 7 }));
  await assertSucceeds(deleteDoc(doc(owner, `${org}/drafts/q1_r1_full`)));
});

test("G2q-c: the owner sets the deposit (1-100%, over K0.00 or more) and follow-up days (1-60), and clears them", async () => {
  const { org, owner, member } = await setup();
  await assertSucceeds(updateDoc(doc(owner, org), { depositPercent: 30, depositOverToea: 500_000, quoteFollowUpDays: 7 }));
  await assertSucceeds(updateDoc(doc(owner, org), { depositPercent: 100, depositOverToea: 0, quoteFollowUpDays: 60 }));
  await assertSucceeds(updateDoc(doc(owner, org), { depositPercent: deleteField(), depositOverToea: deleteField(), quoteFollowUpDays: deleteField() }));
  await assertFails(updateDoc(doc(owner, org), { depositPercent: 0 }));
  await assertFails(updateDoc(doc(owner, org), { depositPercent: 101 }));
  await assertFails(updateDoc(doc(owner, org), { depositPercent: 12.5 }));
  await assertFails(updateDoc(doc(owner, org), { depositOverToea: -1 }));
  await assertFails(updateDoc(doc(owner, org), { depositOverToea: 0.5 }));
  await assertFails(updateDoc(doc(owner, org), { quoteFollowUpDays: 0 }));
  await assertFails(updateDoc(doc(owner, org), { quoteFollowUpDays: 61 }));
  await assertFails(updateDoc(doc(member, org), { quoteFollowUpDays: 7 }));
});
