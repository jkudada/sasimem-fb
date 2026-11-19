/**
 * G2a T4 (docs/test-lists/general-g2.md): an owner with one-off invoices adds an item,
 * writes an invoice for a customer and sends it; the customer's email has the PDF. The
 * Rentals month still lists rent invoices only.
 */
import { expect, test } from "./phone.js";
import { draftThisMonth, onboard } from "./landlord.js";
import { mailTo, switchOn } from "./emulator.js";

test("one-off: add an item and a customer, write an invoice, send it; the PDF arrives and the rent month is untouched", async ({ page }) => {
  test.slow(); // onboarding, then two cold callables (issueInvoice, draftNow): past 30 s on a busy machine
  const start = new Date();
  const email = await onboard(page);
  await switchOn(email, ["rentals", "repeating", "oneOff"]);
  await page.reload(); // the app reads the org once when it opens

  await page.getByRole("link", { name: "Price list" }).click();
  await page.getByRole("link", { name: "Add an item" }).click();
  await page.getByLabel("Item name").fill("Labour");
  await page.getByLabel(/^Price/).fill("K80");
  await page.getByLabel(/^Unit/).fill("hour");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("K80.00 per hour")).toBeVisible();

  await page.goto("/tenants/new");
  await page.getByLabel("Customer's name").fill("Kila Trading");
  await page.getByLabel("Customer's email").fill("accounts@kila.example");
  await page.getByLabel("Their TIN").fill("500012345");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Kila Trading" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "One-off invoices" }).click();
  await page.getByRole("link", { name: "New invoice" }).click();
  await page.getByRole("combobox", { name: "Customer" }).selectOption({ label: "Kila Trading" });
  await page.getByRole("combobox", { name: "Add from your price list" }).selectOption({ label: "Labour · K80.00 per hour" });
  await page.getByRole("group", { name: "Line 1" }).getByLabel("Quantity").fill("2.5");
  await expect(page.getByLabel("Totals")).toContainText("K200.00");
  await page.getByLabel(/order number/).fill("PO-7731");
  await page.getByRole("button", { name: "Send invoice" }).click();
  // The first callable can meet a cold Functions emulator, well past 5 s.
  await expect(page.getByText("Sent INV-0001 to Kila Trading.")).toBeVisible({ timeout: 30_000 });

  const mail = await mailTo("accounts@kila.example", start, /INV-0001/);
  expect(mail.attachments).toEqual([{ filename: "INV-0001.pdf", bytes: expect.any(Number) }]);
  expect(mail.attachments[0]?.bytes).toBeGreaterThan(1000);

  await page.getByRole("link", { name: "See your one-off invoices" }).click();
  await expect(page.getByText("INV-0001 · Kila Trading")).toBeVisible();

  // The Rentals month lists rent invoices only, though the one-off records this month too.
  await page.goto("/");
  await draftThisMonth(page);
  await page.getByRole("link", { name: "Review 1 invoice" }).click();
  await expect(page.getByText("Peter Kila", { exact: true })).toBeVisible();
  await expect(page.getByText("Kila Trading")).toHaveCount(0);
});
