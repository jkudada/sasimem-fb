import { fireEvent, render, screen } from "@testing-library/preact";
import type { Period, Toea } from "@sasimem/core";
import { describe, expect, test, vi } from "vitest";
import type { Month, MonthInvoice } from "../setup.js";
import { MonthCard } from "./MonthCard.js";
import { Review } from "./Review.js";

const OCT = "2026-10" as Period;
const sendAt = new Date("2026-09-30T22:00:00Z"); // 8:00 am, 1 October, Port Moresby
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const inv = (over: Partial<MonthInvoice> = {}): MonthInvoice => ({
  id: "k1_2026-10", tenantName: "Peter Kila", unitLabel: "Flat 1", status: "draft", rentToea: 120_000 as Toea, totalToea: 120_000 as Toea, number: null, ...over,
});
const month = (over: Partial<Month> = {}): Month => ({
  period: OCT, status: "awaitingApproval", sendAt, totalToea: 210_000 as Toea, invoiceCount: 2,
  invoices: [inv(), inv({ id: "k2_2026-10", tenantName: "Mary Wari", unitLabel: "Flat 2", rentToea: 90_000 as Toea, totalToea: 90_000 as Toea })],
  ...over,
});
const tz = "Pacific/Port_Moresby";
// Poll every 5 ms, not vi.waitFor's default 50: this is T1, held to 100 ms a test.
const idle = () => vi.waitFor(() => expect(screen.getAllByRole("button").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true), { interval: 5 });

describe("home: this month's one action (plan §7, screen 3)", () => {
  test("before drafting, it offers to generate this month's invoices now", async () => {
    const onDraftNow = vi.fn().mockResolvedValue({ ok: true, message: "Sent you the approval link for October 2026." });
    render(<MonthCard period={OCT} month={null} timezone={tz} onDraftNow={onDraftNow} />);
    click("Generate October's invoices now");
    expect(onDraftNow).toHaveBeenCalledWith(OCT);
    expect(await screen.findByText("Sent you the approval link for October 2026.")).toBeTruthy();
  });

  test("waiting for approval, it says how many to review and links to them", () => {
    render(<MonthCard period={OCT} month={month()} timezone={tz} onDraftNow={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Review 2 invoices" }).getAttribute("href")).toBe("/month/2026-10");
    expect(screen.getByText(/K2,100.00/)).toBeTruthy();
  });

  test("held, it says so first and asks for approval now", () => {
    render(<MonthCard period={OCT} month={month({ status: "held" })} timezone={tz} onDraftNow={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Held - approve now" })).toBeTruthy();
    expect(screen.getByText(/were not sent/i)).toBeTruthy();
  });

  test("approved, it says when they go out, in the landlord's time", () => {
    render(<MonthCard period={OCT} month={month({ status: "approved" })} timezone={tz} onDraftNow={vi.fn()} />);
    expect(screen.getByText("Approved - goes out at 8:00 am on 1 October 2026.")).toBeTruthy();
  });
});

describe("reviewing a month's invoices", () => {
  const actions = () => ({
    onSetRent: vi.fn().mockResolvedValue({ ok: true, message: "" }),
    onExclude: vi.fn().mockResolvedValue({ ok: true, message: "" }),
    onInclude: vi.fn().mockResolvedValue({ ok: true, message: "" }),
    onRebuild: vi.fn().mockResolvedValue({ ok: true, message: "" }),
    onApprove: vi.fn().mockResolvedValue({ ok: true, message: "Approved 2 invoices." }),
  });

  test("shows each invoice's tenant, unit, rent and total, and the month's total", () => {
    render(<Review month={month()} timezone={tz} {...actions()} />);
    expect(screen.getByText("Peter Kila")).toBeTruthy();
    expect((screen.getByLabelText(/^rent for Mary Wari/i) as HTMLInputElement).value).toBe("K900.00");
    expect(screen.getByText(/K2,100.00/)).toBeTruthy();
  });

  test("a changed rent is read as kina and saved for that invoice; a bad one is a message", async () => {
    const a = actions();
    render(<Review month={month()} timezone={tz} {...a} />);
    fireEvent.input(screen.getByLabelText(/^rent for Peter Kila/i), { target: { value: "K1,000" } });
    click("Save rent for Peter Kila");
    expect(a.onSetRent).toHaveBeenCalledWith("k1_2026-10", 100_000);
    await idle(); // controls are disabled while a change saves
    fireEvent.input(screen.getByLabelText(/^rent for Peter Kila/i), { target: { value: "lots" } });
    click("Save rent for Peter Kila");
    expect(await screen.findByText("Enter an amount like K1,200.00.")).toBeTruthy();
    expect(a.onSetRent).toHaveBeenCalledTimes(1);
  });

  test("unticking leaves an invoice out, and ticking puts it back", async () => {
    const a = actions();
    render(<Review month={month({ invoices: [inv(), inv({ id: "k2_2026-10", tenantName: "Mary Wari", status: "excluded" })] })} timezone={tz} {...a} />);
    fireEvent.click(screen.getByLabelText(/invoice Peter Kila this month/i));
    await idle();
    fireEvent.click(screen.getByLabelText(/invoice Mary Wari this month/i));
    expect(a.onExclude).toHaveBeenCalledWith("k1_2026-10");
    expect(a.onInclude).toHaveBeenCalledWith("k2_2026-10");
  });

  test("approve says how many, and shows the result", async () => {
    const a = actions();
    render(<Review month={month()} timezone={tz} {...a} />);
    click("Approve 2 invoices");
    expect(a.onApprove).toHaveBeenCalledWith(OCT);
    expect(await screen.findByText("Approved 2 invoices.")).toBeTruthy();
  });

  test("rebuild warns that rent changes are discarded, and only rebuilds when confirmed", () => {
    const a = actions();
    render(<Review month={month()} timezone={tz} {...a} />);
    click("Rebuild from tenancy details");
    expect(screen.getByText(/discards any rent you changed/i)).toBeTruthy();
    expect(a.onRebuild).not.toHaveBeenCalled();
    click("Rebuild anyway");
    expect(a.onRebuild).toHaveBeenCalledWith(OCT);
  });

  test("an approved month shows numbers and nothing to edit", () => {
    render(<Review month={month({ status: "approved", invoices: [inv({ status: "approved", number: "INV-0001" })] })} timezone={tz} {...actions()} />);
    expect(screen.getByText(/INV-0001/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a callable's plain message is shown when it refuses", async () => {
    const a = actions();
    a.onApprove = vi.fn().mockResolvedValue({ ok: false, message: "You need a connection to do this. Check your signal and try again." });
    render(<Review month={month()} timezone={tz} {...a} />);
    click("Approve 2 invoices");
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
