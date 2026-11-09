/** What every journey starts with: a landlord signed up and onboarded, and a month drafted. */
import { type Page, expect } from "@playwright/test";
import { confirmEmail, invite } from "./emulator.js";

/** Create an account and confirm its email (sign-up is by invitation: docs/PLAN-TEMPLATES.md §7); lands on "Your details". */
export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: /create an account/i }).click();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill("secret-123");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await confirmEmail(email);
  await page.getByRole("button", { name: "I have opened the link" }).click();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
}

/** An invited landlord signs up, gives the org's details and a first tenant; lands on home. Returns their email. */
export async function onboard(page: Page): Promise<string> {
  const email = `landlord-${crypto.randomUUID()}@test.example`;
  await invite(email);
  await signUp(page, email);
  await page.getByLabel(/name on your invoices/i).fill("Wari Holdings");
  await page.getByLabel(/your address/i).fill("Boroko");
  await page.getByLabel(/bank name/i).fill("BSP");
  await page.getByLabel(/bank account/i).fill("1000 2345");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/property address/i).fill("Lot 4, Boroko");
  await page.getByLabel(/tenant's name/i).fill("Peter Kila");
  await page.getByLabel(/tenant's email/i).fill("peter@kila.example");
  await page.getByLabel(/monthly rent/i).fill("K1,200");
  await page.getByLabel(/day of the month/i).fill("28");
  await page.getByLabel(/payment reference/i).fill("KILA");
  await page.getByRole("button", { name: "Save and finish" }).click();
  await expect(page.getByRole("heading", { name: "Wari Holdings" })).toBeVisible();
  return email;
}

/** Journey 1's ending: generate this month's invoices from home. */
export async function draftThisMonth(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Generate .+'s invoices now$/ }).click();
  // The first callable of a run can meet a cold Functions emulator, well past 5 s.
  await expect(page.getByText(/Sent you the approval link/)).toBeVisible({ timeout: 30_000 });
}
