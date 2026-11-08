import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, test } from "vitest";
import { ACCENTS, FONTS, LAYOUTS, MARKS } from "../../packages/core/src/templates.js";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const shops = { name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "monogram", footer: "Thank you." };

describe("invoice templates (docs/PLAN-TEMPLATES.md §3)", () => {
  test("an owner creates, updates and deletes a template", async () => {
    const s = await seedOrg(env);
    const t = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}/templates/t1`);
    await assertSucceeds(setDoc(t, shops));
    await assertSucceeds(setDoc(t, { ...shops, layout: "compact", footer: "" }));
    await assertSucceeds(deleteDoc(t));
  });

  test("a member of the org reads them; a stranger can neither read nor write", async () => {
    const s = await seedOrg(env);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/templates/t1`), shops);
      await setDoc(doc(ctx.firestore(), `orgs/${s.orgId}/members/m1`), { role: "member", addedAt: new Date() });
    });
    const member = env.authenticatedContext("m1").firestore();
    await assertSucceeds(getDoc(doc(member, `orgs/${s.orgId}/templates/t1`)));
    await assertFails(setDoc(doc(member, `orgs/${s.orgId}/templates/t2`), shops));
    const stranger = env.authenticatedContext("stranger").firestore();
    await assertFails(getDoc(doc(stranger, `orgs/${s.orgId}/templates/t1`)));
    await assertFails(setDoc(doc(stranger, `orgs/${s.orgId}/templates/t2`), shops));
    await assertFails(deleteDoc(doc(stranger, `orgs/${s.orgId}/templates/t1`)));
  });

  test("every layout, palette colour, font and mark core offers is accepted", async () => {
    const s = await seedOrg(env);
    const t = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}/templates/t1`);
    for (const l of LAYOUTS) await assertSucceeds(setDoc(t, { ...shops, layout: l.id }));
    for (const a of ACCENTS) await assertSucceeds(setDoc(t, { ...shops, accent: a.hex }));
    for (const f of FONTS) await assertSucceeds(setDoc(t, { ...shops, font: f.id }));
    for (const m of MARKS) await assertSucceeds(setDoc(t, { ...shops, mark: m.id }));
    await assertSucceeds(setDoc(t, { ...shops, name: "x".repeat(40), footer: "x".repeat(200) }));
  });

  test("a bad layout, an off-palette colour, an unknown font or mark, a long or blank name, a long note or an extra key is refused", async () => {
    const s = await seedOrg(env);
    const t = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}/templates/t1`);
    for (const bad of [
      { layout: "fancy" }, { accent: "#ff0000" }, { accent: "red" }, { font: "comic" }, { mark: "stamp" },
      { name: "" }, { name: "   " }, { name: "x".repeat(41) }, { footer: "x".repeat(201) }, { footer: null }, { createdAt: new Date() },
    ]) await assertFails(setDoc(t, { ...shops, ...bad }));
    const { footer: _, ...missing } = shops;
    await assertFails(setDoc(t, missing));
  });

  test("an owner sets and clears the org's default template; anything but a plain id is refused", async () => {
    const s = await seedOrg(env);
    const org = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}`);
    await assertSucceeds(updateDoc(org, { defaultTemplateId: "abcDEF123_-" }));
    await assertSucceeds(updateDoc(org, { defaultTemplateId: deleteField() }));
    for (const bad of ["", "a/b", "x".repeat(65), 7, null]) await assertFails(updateDoc(org, { defaultTemplateId: bad }));
    await assertFails(updateDoc(doc(env.authenticatedContext("stranger").firestore(), `orgs/${s.orgId}`), { defaultTemplateId: "t1" }));
  });
});
