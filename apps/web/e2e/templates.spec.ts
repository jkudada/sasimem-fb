/**
 * Journey 5 (docs/PLAN-TEMPLATES.md): a landlord makes a template, sees a sample PDF of
 * it, and the next invoice they approve is frozen with it.
 */
import { readFile } from "node:fs/promises";
import { frozenTemplatesOf } from "./emulator.js";
import { draftThisMonth, onboard } from "./landlord.js";
import { expect, test } from "./phone.js";

test("journey 5: make a Band template the default, preview it, and approve an invoice in it", async ({ page }) => {
  const email = await onboard(page);
  await page.getByRole("link", { name: /settings/i }).click();
  await page.getByRole("link", { name: "Invoice templates" }).click();
  await expect(page.getByRole("region", { name: "Classic (built in)" }).getByText("Default: used for every invoice")).toBeVisible();

  await page.getByRole("link", { name: "New template" }).click();
  await page.getByLabel("Template name").fill("Shops");
  await page.getByLabel(/^Band/).check();
  await page.getByLabel("Ocean").check();
  await page.getByLabel(/Traditional/).check();
  await page.getByLabel(/Note on every invoice/).fill("Thank you. Rent is due on the 28th.");
  await expect(page.getByRole("img", { name: "Sketch of the Band layout" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "See a sample PDF" }).click();
  const sample = await download;
  expect(sample.suggestedFilename()).toBe("sample-invoice.pdf");
  const bytes = await readFile(await sample.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.toString("latin1")).toMatch(/\/BaseFont \/Times-Roman/);

  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("region", { name: "Shops" }).getByText("Default: used for every invoice")).toBeVisible();
  await expect(page.getByRole("region", { name: "Shops" }).getByText("Band · Ocean · Traditional")).toBeVisible();

  await page.goto("/");
  await draftThisMonth(page);
  await page.getByRole("link", { name: "Review 1 invoice" }).click();
  await page.getByRole("button", { name: "Approve 1 invoice" }).click();
  await expect(page.getByText(/^Approved - goes out at/)).toBeVisible({ timeout: 30_000 }); // approving renders the PDF
  expect(await frozenTemplatesOf(email)).toEqual([
    { name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "logo", footer: "Thank you. Rent is due on the 28th." },
  ]);
});

test("journey 6: a tenancy overrides the default template; review shows it and approval freezes it", async ({ page }) => {
  const email = await onboard(page);
  const newTemplate = async (name: string, layout: RegExp, makeDefault: boolean) => {
    await page.goto("/settings/templates/new");
    await page.getByLabel("Template name").fill(name);
    await page.getByLabel(layout).check();
    await page.getByLabel("Use this template for all my invoices").setChecked(makeDefault);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("region", { name })).toBeVisible();
  };
  await newTemplate("Shops", /^Band/, true);
  await newTemplate("Plain", /^Compact/, false);

  await page.goto("/properties");
  await page.getByRole("link", { name: /Peter Kila/ }).click();
  await expect(page.getByLabel("Invoice template").locator("option").first()).toHaveText("Use default (Shops)");
  await page.getByLabel("Invoice template").selectOption({ label: "Plain" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();

  await page.goto("/");
  await draftThisMonth(page);
  await page.getByRole("link", { name: "Review 1 invoice" }).click();
  await expect(page.getByText("Template: Plain")).toBeVisible();
  await page.getByRole("button", { name: "Approve 1 invoice" }).click();
  await expect(page.getByText(/^Approved - goes out at/)).toBeVisible({ timeout: 30_000 }); // approving renders the PDF
  await expect(page.getByText("Template: Plain")).toBeVisible(); // now the frozen one
  expect((await frozenTemplatesOf(email)).map((t) => [t["name"], t["layout"]])).toEqual([["Plain", "compact"]]);
});
