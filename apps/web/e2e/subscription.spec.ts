/**
 * The landlord's subscription (PLAN-SUBSCRIBERS §8, S4): at the tenancy limit, adding one
 * explains why and leads to Plan & billing, which shows the plan and sends "Ask to change plan".
 */
import { expect, test } from "./phone.js";
import { onboard } from "./landlord.js";
import { mailTo, setSubscription } from "./emulator.js";

test("at the limit, the landlord sees why and asks to change plan, not a save error", async ({ page }) => {
  const email = await onboard(page); // a Standard trial, one tenancy
  await setSubscription(email, { tenancyLimit: 1, activeTenancyCount: 1 });
  await page.reload();
  await page.getByRole("link", { name: "Add a tenancy" }).click();
  await expect(page.getByText(/you can have 1 tenancy at once, and you have 1\./)).toBeVisible();
  await expect(page.getByLabel(/monthly rent/i)).toHaveCount(0);

  await page.getByRole("link", { name: "Ask to change plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible();
  await expect(page.getByText("1 of 1 tenancy")).toBeVisible();
  await expect(page.getByText("Free trial")).toBeVisible();
  await expect(page.getByText(/^SUB-\d{4,}$/)).toBeVisible();

  const since = new Date();
  await page.getByLabel(/message/i).fill("Three more flats next month.");
  await page.getByRole("button", { name: "Ask to change plan" }).click();
  // The first call can meet a cold Functions emulator.
  await expect(page.getByText(`Sasimem has your request and will reply to ${email}.`)).toBeVisible({ timeout: 30_000 });
  // No contact set on the emulator: it goes to the sending address, replying to the landlord.
  await expect(mailTo("invoices@mail.sasimem.example" /* functions/.env.demo-sasimem */, since, /^Plan change asked for: Wari Holdings$/)).resolves.toBeTruthy();
});
