/**
 * Journey 8 (docs/PLAN-TEMPLATES.md §7): sign-up is by invitation, from a confirmed email.
 */
import { invite } from "./emulator.js";
import { signUp } from "./landlord.js";
import { expect, test } from "./phone.js";

test("journey 8: an uninvited email is told so; once invited, it creates its organisation and reaches home", async ({ page }) => {
  const email = `newcomer-${crypto.randomUUID()}@test.example`;
  await signUp(page, email); // the account and its confirmed email need no invitation; the organisation does

  const details = async () => {
    await page.getByLabel(/name on your invoices/i).fill("Kila Trading");
    await page.getByLabel(/bank name/i).fill("BSP");
    await page.getByLabel(/bank account/i).fill("2000 1111");
    await page.getByRole("button", { name: "Continue" }).click();
  };
  await details();
  await expect(page.getByText("Sign-up is by invitation for now. Ask Sasimem for an invitation for this email address.")).toBeVisible({ timeout: 30_000 });

  await invite(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your first tenant" })).toBeVisible({ timeout: 30_000 });
});
