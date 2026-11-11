/** The landlord's side of their subscription (PLAN-SUBSCRIBERS §8, S4; docs/test-lists/subscribers.md). */
import { type BankDetails, type CalendarDate, type SubscriptionFields, toea } from "@sasimem/core";
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import type { Setup } from "../setup.js";
import { Home } from "./Home.js";
import { PlanBilling } from "./PlanBilling.js";
import { TenancyForm } from "./TenancyForm.js";

const d = (x: string) => x as CalendarDate;
const sub = (o: Partial<SubscriptionFields> = {}): SubscriptionFields => ({
  planId: "standard", status: "active", interval: "annual", priceToea: toea(40_000), tenancyLimit: 10, limitOverride: null,
  trialEndsOn: null, paidThrough: d("2027-08-31"), graceDays: 14, cancelledOn: null, purgeAfter: null,
  paymentReference: "SUB-0042", activeTenancyCount: 7, ...o,
});
const BANK: BankDetails = { accountName: "Sasimem Ltd", bankName: "BSP", accountNumber: "1001 2345 678", branch: "Waigani" };
const setup = (s: SubscriptionFields | null, bank: BankDetails | null = BANK): Setup => ({
  org: {
    name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
    bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto",
  },
  properties: [{ id: "p1", address: "Lot 9", useType: "residential", units: [{ id: "u1", label: "Flat 1" }] }],
  tenants: [{ id: "t1", name: "Kila Trading", email: "a@kila.example", phone: "" }],
  tenancies: [], templates: [], subscription: s, bank,
});
const TODAY = d("2026-09-20");

describe("the banner on home", () => {
  test("restricted: says plainly what stops, what carries on, and how to pay", () => {
    render(<Home setup={setup(sub({ paidThrough: d("2026-08-31") }))} today={TODAY} onSignOut={vi.fn()} />);
    const banner = screen.getByRole("region", { name: "Your Sasimem subscription" });
    expect(banner.textContent).toContain("Next month's invoices will not be drafted until payment arrives. Invoices already approved are sent as normal.");
    expect(banner.textContent).toContain("Pay K400.00 for a year to Sasimem Ltd, BSP account 1001 2345 678 (Waigani), with the reference SUB-0042.");
    expect(screen.getByRole("link", { name: "Plan & billing" }).getAttribute("href")).toBe("/settings/billing");
  });

  test("none while paid up, or when the subscription could not be read", () => {
    const { unmount } = render(<Home setup={setup(sub())} today={TODAY} onSignOut={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Your Sasimem subscription" })).toBeNull();
    unmount();
    render(<Home setup={setup(null)} today={TODAY} onSignOut={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Your Sasimem subscription" })).toBeNull();
  });
});

describe("at the tenancy limit", () => {
  const form = (s: SubscriptionFields, id: string | null = null) => render(
    <TenancyForm id={id} setup={{ ...setup(s), tenancies: [] }} today={TODAY} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onDone={vi.fn()} />,
  );

  test("adding one explains the limit and offers \"Ask to change plan\", not a form that would fail on save", () => {
    form(sub({ activeTenancyCount: 10 }));
    expect(screen.getByText(/On Standard you can have 10 tenancies at once, and you have 10\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask to change plan" }).getAttribute("href")).toBe("/settings/billing#change");
    expect(screen.queryByLabelText(/monthly rent/i)).toBeNull();
  });

  test("under the limit, the form is there", () => {
    form(sub({ activeTenancyCount: 9 }));
    expect(screen.getByLabelText(/monthly rent/i)).toBeTruthy();
  });
});

describe("Plan & billing", () => {
  const page = (s: SubscriptionFields | null, opts: { payments?: unknown; onAsk?: ReturnType<typeof vi.fn> } = {}) => {
    const onAsk = opts.onAsk ?? vi.fn().mockResolvedValue({ ok: true, message: "Sasimem has your request and will reply to mary@wari.example." });
    render(<PlanBilling setup={setup(s)} today={TODAY} loadPayments={vi.fn().mockResolvedValue(opts.payments ?? [])} onAsk={onAsk as never} />);
    return onAsk;
  };

  test("shows the plan, usage, status, dates, how to pay with the reference, and the payments", async () => {
    page(sub(), { payments: [{ id: "bank-BSP%20778", amountToea: 40_000, receivedOn: d("2026-09-01"), bankReference: "BSP 778", coversFrom: d("2026-09-01"), coversTo: d("2027-08-31") }] });
    const facts = document.querySelector("dl.facts")?.textContent;
    expect(facts).toContain("Standard, K400.00 a year");
    expect(facts).toContain("7 of 10 tenancies");
    expect(facts).toContain("Active");
    expect(facts).toContain("Paid through31 August 2027");
    expect(facts).toContain("SUB-0042");
    expect(screen.getByText(/BSP account 1001 2345 678 \(Waigani\), with the reference SUB-0042/)).toBeTruthy();
    expect(await screen.findByText("K400.00 on 1 September 2026 (BSP 778), for 1 September 2026 to 31 August 2027")).toBeTruthy();
  });

  test("a trial shows when it ends", () => {
    page(sub({ status: "trial", trialEndsOn: d("2026-10-30"), paidThrough: null }));
    expect(document.querySelector("dl.facts")?.textContent).toContain("Trial ends30 October 2026");
  });

  test("asking to change plan sends the choice and shows the answer", async () => {
    const onAsk = page(sub());
    fireEvent.input(screen.getByLabelText(/message/i), { target: { value: "More flats" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask to change plan" }));
    expect((await screen.findByRole("status")).textContent).toBe("Sasimem has your request and will reply to mary@wari.example.");
    expect(onAsk).toHaveBeenCalledWith("plus", "annual", "More flats");
  });

  test("a refusal shows the server's words", async () => {
    page(sub(), { onAsk: vi.fn().mockResolvedValue({ ok: false, message: "You have already asked today. Sasimem will reply by email." }) });
    fireEvent.click(screen.getByRole("button", { name: "Ask to change plan" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You have already asked today. Sasimem will reply by email.");
  });

  test("with no subscription it says so plainly", () => {
    page(null);
    expect(screen.getByText(/Your plan could not be loaded/)).toBeTruthy();
  });
});
