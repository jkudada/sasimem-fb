/**
 * G2q-a T4 (docs/test-lists/general-g2q.md): an owner with quotes writes a quote and sends
 * it; the customer's email has the PDF and the link to answer it.
 */
import { expect, test } from "./phone.js";
import { onboard } from "./landlord.js";
import { mailTo, switchOn } from "./emulator.js";

test("quotes: write a quote, send it; the PDF and a /q/ link arrive, and the quote is listed as sent", async ({ page }) => {
  test.slow(); // onboarding, then a cold callable
  const start = new Date();
  const email = await onboard(page);
  await switchOn(email, ["rentals", "repeating", "oneOff", "quotes"]);
  await page.goto("/tenants/new");
  await page.getByLabel("Customer's name").fill("Kila Trading");
  await page.getByLabel("Customer's email").fill("accounts@kila.example");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Kila Trading" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Quotes" }).click();
  await page.getByRole("link", { name: "New quote" }).click();
  await page.getByRole("combobox", { name: "Customer" }).selectOption({ label: "Kila Trading" });
  await page.getByRole("group", { name: "Line 1" }).getByLabel("What for").fill("Rewire the workshop");
  await page.getByRole("group", { name: "Line 1" }).getByLabel("Price each").fill("K2,400");
  await page.getByLabel(/^Days it is valid/).fill("14");
  await page.getByRole("button", { name: "Send quote" }).click();
  await expect(page.getByText("Sent QUO-0001 to Kila Trading.")).toBeVisible({ timeout: 30_000 });

  const mail = await mailTo("accounts@kila.example", start, /^Quote QUO-0001 from /);
  expect(mail.attachments).toEqual([{ filename: "QUO-0001.pdf", bytes: expect.any(Number) }]);
  expect(mail.attachments[0]?.bytes).toBeGreaterThan(1000);
  expect(mail.text).toMatch(/\/q\/[A-Za-z0-9_-]{43}\b/);

  await page.getByRole("link", { name: "See your quotes" }).click();
  await expect(page.getByText("QUO-0001 · Kila Trading")).toBeVisible();
  await expect(page.getByText(/K2,400\.00 · valid until .+ · Sent/)).toBeVisible();
});
