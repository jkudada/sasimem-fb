import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, test } from "vitest";
import { seedOrg } from "./fixtures.js";
import { rulesEnv } from "./harness.js";

let env: RulesTestEnvironment;
beforeAll(async () => { env = await rulesEnv({ storage: true }); });
afterAll(async () => { await env.cleanup(); });

const png = (bytes: number) => new Uint8Array(bytes);
const asPng = { contentType: "image/png" };

describe("logos in Storage (plan §5)", () => {
  test("an owner can upload an image of up to 200 KB to their org's logos folder, and read it back", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).storage();
    await assertSucceeds(uploadBytes(ref(owner, `logos/${s.orgId}/1.png`), png(200 * 1024), asPng));
    await assertSucceeds(getBytes(ref(owner, `logos/${s.orgId}/1.png`)));
  });

  test("a stranger can neither upload nor read an org's logo", async () => {
    const s = await seedOrg(env);
    await env.withSecurityRulesDisabled(async (ctx) => { await uploadBytes(ref(ctx.storage(), `logos/${s.orgId}/1.png`), png(10), asPng); });
    const stranger = env.authenticatedContext("stranger").storage();
    await assertFails(uploadBytes(ref(stranger, `logos/${s.orgId}/2.png`), png(10), asPng));
    await assertFails(getBytes(ref(stranger, `logos/${s.orgId}/1.png`)));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), `logos/${s.orgId}/1.png`)));
  });

  test("a file that is not an image, or is over 200 KB, is refused", async () => {
    const s = await seedOrg(env);
    const owner = env.authenticatedContext(s.ownerUid).storage();
    await assertFails(uploadBytes(ref(owner, `logos/${s.orgId}/1.png`), png(200 * 1024 + 1), asPng));
    await assertFails(uploadBytes(ref(owner, `logos/${s.orgId}/1.html`), png(10), { contentType: "text/html" }));
  });

  test("nothing else in the bucket is open, not even the org's own invoice PDFs", async () => {
    const s = await seedOrg(env);
    await env.withSecurityRulesDisabled(async (ctx) => { await uploadBytes(ref(ctx.storage(), `invoices/${s.orgId}/INV-0001.pdf`), png(10), { contentType: "application/pdf" }); });
    const owner = env.authenticatedContext(s.ownerUid).storage();
    await assertFails(getBytes(ref(owner, `invoices/${s.orgId}/INV-0001.pdf`)));
    await assertFails(uploadBytes(ref(owner, `invoices/${s.orgId}/INV-0002.pdf`), png(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(owner, `elsewhere/x.png`), png(10), asPng));
  });
});
