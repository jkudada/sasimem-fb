import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, test } from "vitest";
import { LOGO_COLOURS, LOGO_FONTS, LOGO_ICONS, LOGO_SHAPES } from "../../packages/core/src/logo.js";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv(); });
afterAll(async () => { await env.cleanup(); });

const wh = { text: "WH", shape: "circle", background: "#1f4e8c", colour: "#ffffff", font: "serif", icon: "house" };

describe("the logo builder's design on the org (docs/PLAN-TEMPLATES.md §5)", () => {
  test("an owner saves and clears it, beside the logo path; a stranger cannot", async () => {
    const s = await seedOrg(env);
    const org = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}`);
    await assertSucceeds(updateDoc(org, { logoDesign: wh, logoPath: `logos/${s.orgId}/1.png` }));
    await assertSucceeds(updateDoc(org, { logoDesign: deleteField() }));
    await assertFails(updateDoc(doc(env.authenticatedContext("stranger").firestore(), `orgs/${s.orgId}`), { logoDesign: wh }));
  });

  test("every shape, font, icon and colour core offers is accepted", async () => {
    const s = await seedOrg(env);
    const org = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}`);
    for (const x of LOGO_SHAPES) await assertSucceeds(updateDoc(org, { logoDesign: { ...wh, shape: x.id, colour: "#1c2321" } }));
    for (const x of LOGO_FONTS) await assertSucceeds(updateDoc(org, { logoDesign: { ...wh, font: x.id } }));
    for (const x of LOGO_ICONS) await assertSucceeds(updateDoc(org, { logoDesign: { ...wh, icon: x.id } }));
    for (const x of LOGO_COLOURS) {
      await assertSucceeds(updateDoc(org, { logoDesign: { ...wh, background: x.hex, colour: x.hex === "#1c2321" ? "#ffffff" : "#1c2321" } }));
    }
    await assertSucceeds(updateDoc(org, { logoDesign: { ...wh, text: "x".repeat(24) } }));
  });

  test("every field is checked: bad values, missing or extra keys, and text that would not show are refused", async () => {
    const s = await seedOrg(env);
    const org = doc(env.authenticatedContext(s.ownerUid).firestore(), `orgs/${s.orgId}`);
    for (const bad of [
      { text: "" }, { text: "  " }, { text: "x".repeat(25) }, { text: 7 }, { shape: "hexagon" }, { font: "comic" }, { icon: "dragon" },
      { background: "#ff0000" }, { colour: "red" }, { shape: "none", colour: "#ffffff" }, { colour: "#1f4e8c" }, { extra: true },
    ]) await assertFails(updateDoc(org, { logoDesign: { ...wh, ...bad } }));
    const { icon: _, ...missing } = wh;
    await assertFails(updateDoc(org, { logoDesign: missing }));
    await assertFails(updateDoc(org, { logoDesign: "WH" }));
  });
});
