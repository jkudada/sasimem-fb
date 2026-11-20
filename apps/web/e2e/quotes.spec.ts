/**
 * G2q T4 (docs/test-lists/general-g2q.md): an owner with quotes writes a quote and sends
 * it; the customer's email has the PDF and the link (G2q-a). The customer accepts on the
 * link with an order number; the owner is emailed and sees it accepted (G2q-b). The owner
 * revises a quote, the customer accepts the new revision, and its invoice draft is sent (G2q-c).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./phone.js";
import { onboard } from "./landlord.js";
import { mailTo, pathOf, switchOn } from "./emulator.js";

/** Onboard an owner with quotes on and send QUO-0001 to Kila Trading, at an address of this test's own. Returns the owner's email and the quote's. */
async function sendAQuote(page: Page, start: Date) {
  const customer = `accounts-${crypto.randomUUID().slice(0, 8)}@kila.example`;
  const email = await onboard(page);
  await switchOn(email, ["rentals", "repeating", "oneOff", "quotes"]);
  await page.goto("/tenants/new");
  await page.getByLabel("Customer's name").fill("Kila Trading");
  await page.getByLabel("Customer's email").fill(customer);
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
  return { email, customer, mail: await mailTo(customer, start, /^Quote QUO-0001 from /) };
}

const linkIn = (text: string): string => /https?:\/\/\S+\/q\/[A-Za-z0-9_-]{43}/.exec(text)?.[0] ?? "";

test("quotes: write a quote, send it; the PDF and a /q/ link arrive, and the quote is listed as sent", async ({ page }) => {
  test.slow(); // onboarding, then a cold callable
  const { mail } = await sendAQuote(page, new Date());
  expect(mail.attachments).toEqual([{ filename: "QUO-0001.pdf", bytes: expect.any(Number) }]);
  expect(mail.attachments[0]?.bytes).toBeGreaterThan(1000);
  expect(mail.text).toMatch(/\/q\/[A-Za-z0-9_-]{43}\b/);

  await page.getByRole("link", { name: "See your quotes" }).click();
  await expect(page.getByText("QUO-0001 · Kila Trading")).toBeVisible();
  await expect(page.getByText(/K2,400\.00 · valid until .+ · Sent/)).toBeVisible();
});

test("quotes: the customer accepts on the link with an order number; the owner is emailed and sees it accepted", async ({ page }) => {
  test.slow(); // onboarding, then a cold callable and the quote page's function
  const start = new Date();
  const { email, mail } = await sendAQuote(page, start);
  const link = linkIn(mail.text);

  await page.goto(pathOf(link));
  await expect(page.getByRole("heading", { name: "Quote QUO-0001" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Rewire the workshop")).toBeVisible();
  await page.getByLabel("Your name").fill("Peter Kila");
  await page.getByLabel(/Your order number/).fill("PO-4471");
  await page.getByLabel("I accept these terms").check();
  await page.getByRole("button", { name: "Accept quote QUO-0001" }).click();
  await expect(page.getByText(/^Accepted by Peter Kila at /)).toBeVisible();
  await expect(page.getByText("Order number PO-4471.")).toBeVisible();

  const told = await mailTo(email, start, /^QUO-0001 accepted by Peter Kila$/);
  expect(told.text).toContain("Order number: PO-4471");

  await page.goto("/quotes");
  await expect(page.getByText(/K2,400\.00 · valid until .+ · Accepted/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "QUO-0001 · Kila Trading" }).click();
  await expect(page.getByText(/^Accepted by Peter Kila at .+, on the quote's link\. Order number PO-4471\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo the acceptance" })).toBeVisible();
});

test("quotes: the owner revises a sent quote; the new link accepts it and the old one says replaced; its invoice draft is sent and the quote is Invoiced", async ({ page }) => {
  test.slow(); // onboarding, then cold callables and the quote page's function
  const start = new Date();
  const { customer, mail } = await sendAQuote(page, start);
  const first = linkIn(mail.text);

  await page.getByRole("link", { name: "See your quotes" }).click();
  await page.getByRole("link", { name: "QUO-0001 · Kila Trading" }).click();
  await page.getByRole("button", { name: "Revise" }).click();
  await expect(page.getByRole("heading", { name: "Revising QUO-0001" })).toBeVisible();
  await page.getByRole("group", { name: "Line 1" }).getByLabel("Price each").fill("K2,200");
  await page.getByRole("button", { name: "Send revision 2" }).click();
  await expect(page.getByText("Sent QUO-0001 rev 2 to Kila Trading.")).toBeVisible({ timeout: 30_000 });
  const second = linkIn((await mailTo(customer, start, /^Quote QUO-0001 rev 2 \(replaces rev 1\) from /)).text);

  await page.goto(pathOf(first));
  await expect(page.getByRole("heading", { name: "This quote was replaced" })).toBeVisible({ timeout: 30_000 });
  await page.goto(pathOf(second));
  await expect(page.getByRole("heading", { name: "Quote QUO-0001 rev 2" })).toBeVisible();
  await page.getByLabel("Your name").fill("Peter Kila");
  await page.getByLabel("I accept these terms").check();
  await page.getByRole("button", { name: "Accept quote QUO-0001 rev 2" }).click();
  await expect(page.getByText(/^Accepted by Peter Kila at /)).toBeVisible();

  await page.goto("/quotes");
  await page.getByRole("link", { name: "QUO-0001 rev 2 · Kila Trading" }).click();
  await expect(page.getByText("Nothing invoiced yet.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "The invoice" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await expect(page.getByText("Sent INV-0001 to Kila Trading.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/quotes");
  await expect(page.getByText(/K2,200\.00 · valid until .+ · Invoiced/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "QUO-0001 rev 2 · Kila Trading" }).click();
  await expect(page.getByText("Invoiced in full.")).toBeVisible();
  await expect(page.getByText("INV-0001 · K2,200.00")).toBeVisible();
});
