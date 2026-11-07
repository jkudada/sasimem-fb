/**
 * The four T4 journeys (plan §9.2). Journey 3 fires the real scheduled tick through the
 * Functions emulator (see runTheTick), after moving the month's send time into the past.
 */
import { type Page, expect, test } from "@playwright/test";
import { expire, linksMailedTo, mailTo, pathOf, runTheTick, sendTimeHasPassed } from "./emulator.js";

/** Sign up, give the org's details and a first tenant; lands on home. Returns the landlord's email. */
async function onboard(page: Page): Promise<string> {
  const email = `landlord-${crypto.randomUUID()}@test.example`;
  await page.goto("/");
  await page.getByRole("link", { name: /create an account/i }).click();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill("secret-123");
  await page.getByRole("button", { name: /create/i }).click();
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
async function draftThisMonth(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Generate .+'s invoices now$/ }).click();
  await expect(page.getByText(/Sent you the approval link/)).toBeVisible();
}

test("journey 1: onboarding to first draft", async ({ page }) => {
  await onboard(page);
  await draftThisMonth(page);
  await page.getByRole("link", { name: "Review 1 invoice" }).click();
  await expect(page.getByText("Peter Kila", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^rent for Peter Kila/i)).toHaveValue("K1,200.00");
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("journey 2: approve from the emailed link", async ({ page, browser }) => {
    // Onboarding needs the app (JavaScript); the approval link must not.
    const app = await browser.newPage({ javaScriptEnabled: true });
    const email = await onboard(app);
    await draftThisMonth(app);
    const [link] = await linksMailedTo(email);
    await page.goto(pathOf(link ?? ""));
    await expect(page.getByRole("checkbox", { name: "Invoice Peter Kila this month" })).toBeChecked();
    await page.getByLabel("Rent for Peter Kila").fill("K1,100.00");
    await page.getByRole("button", { name: "Approve 1 invoice" }).click();
    await expect(page.getByText(/^Approved - goes out at/)).toBeVisible();
    await expect(page.getByText(/INV-0001 · Peter Kila · K1,100.00/)).toBeVisible();
    await app.close();
  });

  test("journey 4: an expired link leads to a fresh-link request", async ({ page, browser }) => {
    const app = await browser.newPage({ javaScriptEnabled: true });
    const email = await onboard(app);
    await draftThisMonth(app);
    const [link] = await linksMailedTo(email);
    await expire(link ?? "");
    await page.goto(pathOf(link ?? ""));
    await expect(page.getByText("Peter Kila")).toHaveCount(0); // a dead link shows no invoices
    await page.getByRole("button", { name: "Email me a new link" }).click();
    await expect(page.getByText(/A new link is on its way to l•••@test.example/)).toBeVisible();
    const links = await linksMailedTo(email, 2);
    await page.goto(pathOf(links[1] ?? ""));
    await expect(page.getByRole("button", { name: "Approve 1 invoice" })).toBeVisible();
    await app.close();
  });
});

test("journey 3: past the send time the tick emails the tenant their invoice and PDF, then it is marked paid", async ({ page }) => {
  const start = new Date();
  const email = await onboard(page);
  await draftThisMonth(page);
  await page.getByRole("link", { name: "Review 1 invoice" }).click();
  await page.getByRole("button", { name: "Approve 1 invoice" }).click();
  await expect(page.getByText(/^Approved - goes out at/)).toBeVisible();

  await sendTimeHasPassed(email);
  await runTheTick();
  const invoice = await mailTo("peter@kila.example", start, /^Invoice INV-0001 from Wari Holdings - K1,200.00 due /);
  expect(invoice.attachments).toEqual([{ filename: "INV-0001.pdf", bytes: expect.any(Number) }]);
  expect(invoice.attachments[0]?.bytes).toBeGreaterThan(1000);
  await mailTo(email, start, /^Sent - your .+ invoice is with your tenant$/);

  await page.goto("/");
  await expect(page.getByText("Sent to your tenants. 0 of 1 paid.")).toBeVisible();
  await expect(page.getByRole("link", { name: "K1,200.00 owed across all months" })).toBeVisible();
  await page.getByRole("link", { name: "See who has paid" }).click();
  await page.getByLabel("Note for INV-0001 (optional)").fill("Bank transfer");
  await page.getByRole("button", { name: "Mark INV-0001 paid" }).click();
  await expect(page.getByText("1 of 1 paid")).toBeVisible();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
});
