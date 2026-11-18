/**
 * Journey 7 (docs/PLAN-TEMPLATES.md §5): a landlord builds a logo, and their next
 * invoice prints it. The PNG is drawn by the real browser, so this is where its size
 * and the fonts' loading are checked.
 */
import { logoOf, pdfPathsOf, storedFile } from "./emulator.js";
import { draftThisMonth, onboard } from "./landlord.js";
import { expect, test } from "./phone.js";

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

test("journey 7: build a logo, make a Band template the default, and the approved invoice's PDF carries the logo", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (r) => { if (r.url().endsWith(".woff2")) fonts.push(r.url()); });
  const email = await onboard(page);

  await page.getByRole("link", { name: /settings/i }).click();
  await expect(page.getByRole("heading", { name: "Logo" })).toBeVisible();
  expect(fonts).toEqual([]); // the builder's fonts load on its route only

  await page.getByRole("link", { name: "Design a logo" }).click();
  await page.getByLabel(/^Logo text/).fill("WH");
  await page.getByLabel("Rounded square").check();
  await page.getByLabel("Ocean").first().check();
  await page.getByLabel("Sturdy").check();
  await page.getByLabel("House").check();
  await expect(page.getByRole("img", { name: "Your logo: WH" })).toBeVisible();
  await expect.poll(() => fonts.length).toBe(4);
  await page.getByRole("button", { name: "Save logo" }).click();

  await expect(page.getByRole("link", { name: "Change your logo design" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your logo" })).toBeVisible();
  const stored = await logoOf(email);
  expect(stored.designed).toBe(true);
  expect(stored.logoPath).toMatch(new RegExp(`^logos/${stored.orgId}/\\d+\\.png$`));
  const png = await storedFile(stored.logoPath ?? "");
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(pngSize(png)).toEqual({ width: 400, height: 400 });
  expect(png.length).toBeLessThanOrEqual(200 * 1024);

  // Reopening shows the same choices.
  await page.getByRole("link", { name: "Change your logo design" }).click();
  await expect(page.getByLabel(/^Logo text/)).toHaveValue("WH");
  await expect(page.getByLabel("House")).toBeChecked();
  await expect(page.getByLabel("Sturdy")).toBeChecked();

  await page.goto("/settings/templates/new");
  await page.getByLabel("Template name").fill("Shops");
  await page.getByLabel(/^Band/).check();
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("region", { name: "Shops" }).getByText("Default: used for every invoice")).toBeVisible();

  await page.goto("/");
  await draftThisMonth(page);
  await page.getByRole("link", { name: "Review 1 invoice" }).click();
  await page.getByRole("button", { name: "Approve 1 invoice" }).click();
  await expect(page.getByText(/^Approved - goes out at/)).toBeVisible({ timeout: 30_000 }); // approving renders the PDF
  await expect.poll(async () => (await pdfPathsOf(email)).filter((p) => p !== "").length).toBe(1);
  const pdf = (await storedFile((await pdfPathsOf(email))[0] ?? "")).toString("latin1");
  expect(pdf).toMatch(/\/Subtype \/Image/);

  // Uploading a file instead forgets the design; removing the logo clears both.
  await page.goto("/settings");
  await page.getByLabel(/Logo \(optional\)/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Logo saved.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Design a logo" })).toBeVisible();
  expect((await logoOf(email)).designed).toBe(false);

  // A photo over 200 KB is made smaller in the browser, to 400 px, then saved.
  const photo = Buffer.from(await page.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 2400, height: 1600 });
    const ctx = c.getContext("2d");
    if (ctx === null) throw new Error("no canvas");
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const x = (i / 4) % c.width;
      img.data.set([(x / c.width) * 255 + Math.random() * 40, 120 + Math.random() * 40, 90, 255], i);
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.95));
    if (blob === null) throw new Error("no JPEG");
    const url = await new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(String(f.result)); f.readAsDataURL(blob); });
    return url.slice(url.indexOf(",") + 1);
  }), "base64");
  expect(photo.length).toBeGreaterThan(200 * 1024);
  await page.getByLabel(/Logo \(optional\)/).setInputFiles({ name: "Shop photo.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText("Logo saved.")).toBeVisible();
  const shrunk = await logoOf(email);
  expect(shrunk.logoPath).toMatch(/\.jpg$/);
  const jpeg = await storedFile(shrunk.logoPath ?? "");
  expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
  expect(jpeg.length).toBeLessThanOrEqual(200 * 1024);
  await expect.poll(() => page.getByRole("img", { name: "Your logo" }).evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([400, 267]);

  await page.getByRole("button", { name: "Remove logo" }).click();
  await expect(page.getByText("Logo removed.")).toBeVisible();
  expect(await logoOf(email)).toMatchObject({ logoPath: null, designed: false });
});

