// G1b (docs/test-lists/general-g1.md): customers are stored at orgs/{orgId}/tenants,
// with optional business details beside today's name, email and phone.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { CUSTOMER_EXTRAS } from "../../packages/core/src/customers.js";
import { addDoc, collection, doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const full = {
  name: "Kila Trading", email: "accounts@kila.example", phone: "7000 0000",
  ccEmails: ["boss@kila.example", "site@kila.example", "pay@kila.example"],
  address: "Section 5, Lot 9, Gordons", tin: "500012345", gstNumber: "GST-1234",
  termsDays: 14, poRequired: true, notes: "Send to accounts.",
};

async function ownerOf() {
  const s = await seedOrg(env);
  return { s, customers: collection(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}/tenants`) };
}

test("an owner saves a customer with every business detail, or with none (today's tenant)", async () => {
  const { customers } = await ownerOf();
  await assertSucceeds(addDoc(customers, full));
  await assertSucceeds(addDoc(customers, { name: "Peter Kila", email: "peter@kila.example", phone: "" }));
  await assertSucceeds(addDoc(customers, { ...full, termsDays: null, ccEmails: [], tin: "", notes: "" }));
});

test("the rules accept exactly the extras core names", () => {
  expect(CUSTOMER_EXTRAS).toEqual(Object.keys(full).filter((k) => !["name", "email", "phone"].includes(k)));
});

test("bad business details are refused", async () => {
  const { customers } = await ownerOf();
  for (const bad of [
    { ccEmails: ["a@x.example", "b@x.example", "c@x.example", "d@x.example"] },
    { ccEmails: ["not an email"] },
    { ccEmails: "boss@kila.example" },
    { address: "x".repeat(201) },
    { tin: "1".repeat(21) },
    { gstNumber: 1234 },
    { termsDays: 91 },
    { termsDays: 7.5 },
    { termsDays: "14" },
    { poRequired: "yes" },
    { notes: "x".repeat(501) },
    { creditToea: 500 }, // server-only, later
  ]) {
    await assertFails(addDoc(customers, { ...full, ...bad }));
  }
});

test("the Rentals tenant form's merge of name, email and phone keeps the business details", async () => {
  const { s, customers } = await ownerOf();
  const ref = doc(customers, s.tenantId);
  await assertSucceeds(setDoc(ref, full));
  await assertSucceeds(setDoc(ref, { name: "Kila Trading Ltd", email: "accounts@kila.example", phone: "" }, { merge: true }));
});

test("a stranger cannot write a customer", async () => {
  const s = await seedOrg(env);
  const stranger = env.authenticatedContext("stranger").firestore();
  await assertFails(addDoc(collection(stranger, `orgs/${s.orgId}/tenants`), full));
});
