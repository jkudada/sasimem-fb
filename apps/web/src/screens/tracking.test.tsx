import { fireEvent, render, screen } from "@testing-library/preact";
import type { Arrears, CalendarDate, Period, Toea } from "@sasimem/core";
import { describe, expect, test, vi } from "vitest";
import type { Month, MonthInvoice, OwedInvoice } from "../setup.js";
import { Invoices } from "./Invoices.js";
import { MonthCard } from "./MonthCard.js";
import { Owed } from "./Owed.js";
import { Tracking } from "./Tracking.js";

const OCT = "2026-10" as Period;
const today = "2026-10-12" as CalendarDate; // due 8 October: overdue
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const done = { ok: true, message: "" };
const idle = () => vi.waitFor(() => expect(screen.getAllByRole("button").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true), { interval: 5 });
const inv = (over: Partial<MonthInvoice> = {}): MonthInvoice => ({
  id: "k1_2026-10", tenantName: "Peter Kila", unitLabel: "Flat 1", status: "sent", rentToea: 120_000 as Toea, totalToea: 120_000 as Toea,
  number: "INV-0001", dueDate: "2026-10-08" as CalendarDate, paidNote: "", remindersPaused: false, ...over,
});
const sent = (over: Partial<Month> = {}): Month => ({
  period: OCT, status: "sent", sendAt: new Date("2026-09-30T22:00:00Z"), totalToea: 210_000 as Toea, invoiceCount: 2,
  invoices: [inv(), inv({ id: "k2_2026-10", tenantName: "Mary Wari", number: "INV-0002", status: "paid", totalToea: 90_000 as Toea, paidNote: "cash" })],
  emails: [], ...over,
});
const actions = () => ({
  onMarkPaid: vi.fn().mockResolvedValue(done), onMarkUnpaid: vi.fn().mockResolvedValue(done),
  onPauseReminders: vi.fn().mockResolvedValue(done), onVoid: vi.fn().mockResolvedValue(done),
  onResend: vi.fn().mockResolvedValue({ ok: true, message: "Emailed INV-0001 to k1@tenant.example again." }), onOpenPdf: vi.fn().mockResolvedValue(done),
});

describe("a sent month (plan §7, screen 5)", () => {
  test("each invoice shows its number, tenant, total and where it stands, with the month's paid count", () => {
    render(<Tracking month={sent()} today={today} {...actions()} />);
    expect(screen.getByText("1 of 2 paid · K1,200.00 still unpaid")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText(/INV-0001 · Peter Kila/)).toBeTruthy();
  });

  test("mark paid takes an optional note; not paid after all takes the tick back", async () => {
    const a = actions();
    render(<Tracking month={sent()} today={today} {...a} />);
    fireEvent.input(screen.getByLabelText("Note for INV-0001 (optional)"), { target: { value: "Bank transfer" } });
    click("Mark INV-0001 paid");
    expect(a.onMarkPaid).toHaveBeenCalledWith("k1_2026-10", "Bank transfer");
    await idle();
    click("INV-0002 not paid after all");
    expect(a.onMarkUnpaid).toHaveBeenCalledWith("k2_2026-10");
  });

  test("the PDF, the reminder switch and email again", async () => {
    const a = actions();
    render(<Tracking month={sent()} today={today} {...a} />);
    click("PDF of INV-0001");
    expect(a.onOpenPdf).toHaveBeenCalledWith("k1_2026-10");
    await idle();
    click("Pause reminders for INV-0001");
    expect(a.onPauseReminders).toHaveBeenCalledWith("k1_2026-10", true);
    await idle();
    click("Email INV-0001 again");
    expect(await screen.findByText("Emailed INV-0001 to k1@tenant.example again.")).toBeTruthy();
  });

  test("a paused invoice offers to resume", () => {
    render(<Tracking month={sent({ invoices: [inv({ remindersPaused: true })] })} today={today} {...actions()} />);
    expect(screen.getByRole("button", { name: "Resume reminders for INV-0001" })).toBeTruthy();
  });

  test("void asks for a reason and a second tap before it does anything", async () => {
    const a = actions();
    render(<Tracking month={sent()} today={today} {...a} />);
    click("Void INV-0001…");
    click("Void INV-0001");
    expect(await screen.findByText("Say why this invoice is void.")).toBeTruthy();
    expect(a.onVoid).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText("Why is INV-0001 void?"), { target: { value: "Moved out" } });
    click("Void INV-0001");
    expect(a.onVoid).toHaveBeenCalledWith("k1_2026-10", "Moved out");
  });

  test("the month's emails are listed, and one that was refused says so", () => {
    render(<Tracking month={sent({ emails: [
      { id: "e1", kind: "tenantInvoice", to: "k1@tenant.example", subject: "Invoice INV-0001", status: "failed", sentAt: new Date("2026-09-30T22:00:00Z"), error: "Invalid `to` field." },
      { id: "e2", kind: "tenantInvoice", to: "k2@tenant.example", subject: "Invoice INV-0002", status: "sent", sentAt: new Date("2026-09-30T22:00:00Z"), error: null },
    ] })} today={today} {...actions()} />);
    expect(screen.getByText(/Not delivered to k1@tenant.example/)).toBeTruthy();
    expect(screen.getByText(/Sent to k2@tenant.example/)).toBeTruthy();
  });
});

describe("what is owed (plan §7, screen 6)", () => {
  const o = (over: Partial<OwedInvoice>): OwedInvoice => ({ id: "x", tenantId: "t1", tenantName: "Peter Kila", number: "INV-0001", period: OCT, status: "sent", dueDate: "2026-10-08" as CalendarDate, totalToea: 120_000 as Toea, ...over });
  const groups: Arrears<OwedInvoice>[] = [
    { tenantId: "t2", tenantName: "Mary Wari", oldestDue: "2026-09-08" as CalendarDate, totalToea: 90_000, invoices: [o({ id: "b", tenantId: "t2", tenantName: "Mary Wari", number: "INV-0002", period: "2026-09" as Period, dueDate: "2026-09-08" as CalendarDate, totalToea: 90_000 as Toea })] },
    { tenantId: "t1", tenantName: "Peter Kila", oldestDue: "2026-10-08" as CalendarDate, totalToea: 120_000, invoices: [o({ id: "a" })] },
  ];

  test("tenants owing longest first, each with their invoices and total, and the total owed", () => {
    render(<Owed groups={groups} today={today} onMarkPaid={vi.fn()} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Mary Wari · K900.00", "Peter Kila · K1,200.00"]);
    expect(screen.getByText("K2,100.00 owed")).toBeTruthy();
    expect(screen.getByText(/INV-0002 · September 2026/)).toBeTruthy();
  });

  test("nothing owed says so plainly", () => {
    render(<Owed groups={[]} today={today} onMarkPaid={vi.fn()} />);
    expect(screen.getByText("Nothing owed. Every invoice sent has been paid.")).toBeTruthy();
  });

  test("an invoice can be ticked paid from here", () => {
    const onMarkPaid = vi.fn().mockResolvedValue(done);
    render(<Owed groups={groups} today={today} onMarkPaid={onMarkPaid} />);
    click("Mark INV-0002 paid");
    expect(onMarkPaid).toHaveBeenCalledWith("b", "");
  });
});

describe("the invoices screen", () => {
  const months = [
    { period: "2026-11" as Period, status: "awaitingApproval" as const, invoiceCount: 2, totalToea: 210_000 as Toea },
    { period: OCT, status: "sent" as const, invoiceCount: 2, totalToea: 210_000 as Toea },
  ];

  test("every month with its status in plain words, linking to the month", () => {
    render(<Invoices months={months} thisMonth={OCT} onExport={vi.fn()} />);
    expect(screen.getByRole("link", { name: /November 2026.*Waiting for you/ }).getAttribute("href")).toBe("/month/2026-11");
    expect(screen.getByRole("link", { name: /October 2026.*Sent/ }).getAttribute("href")).toBe("/month/2026-10");
  });

  test("exports a range of months as CSV; a backwards range is a message, not a call", async () => {
    const onExport = vi.fn().mockResolvedValue({ ok: true, message: "" });
    render(<Invoices months={months} thisMonth={OCT} onExport={onExport} />);
    fireEvent.input(screen.getByLabelText("From"), { target: { value: "2026-12" } });
    fireEvent.input(screen.getByLabelText("To"), { target: { value: "2026-01" } });
    click("Download CSV");
    expect(await screen.findByText("The first month must come before the last.")).toBeTruthy();
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText("From"), { target: { value: "2026-01" } });
    fireEvent.input(screen.getByLabelText("To"), { target: { value: "2026-12" } });
    click("Download CSV");
    expect(onExport).toHaveBeenCalledWith("2026-01", "2026-12");
  });
});

describe("home, once the month is sent", () => {
  test("says how many are paid", () => {
    render(<MonthCard period={OCT} month={sent()} timezone="Pacific/Port_Moresby" onDraftNow={vi.fn()} />);
    expect(screen.getByText("Sent to your tenants. 1 of 2 paid.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See who has paid" }).getAttribute("href")).toBe("/month/2026-10");
  });

  test("all paid says so", () => {
    render(<MonthCard period={OCT} month={sent({ invoices: [inv({ status: "paid" })] })} timezone="Pacific/Port_Moresby" onDraftNow={vi.fn()} />);
    expect(screen.getByText("Sent to your tenants. All paid.")).toBeTruthy();
  });
});

describe("home: the amount owed (plan §7, screen 3)", () => {
  const setup = { org: { name: "Wari Holdings" }, properties: [], tenants: [], tenancies: [] } as never;

  test("shows what is owed across all months, linking to the owed screen, and the invoices screen", async () => {
    const { Home } = await import("./Home.js");
    render(<Home setup={setup} owedToea={210_000} onSignOut={vi.fn()} />);
    expect(screen.getByRole("link", { name: "K2,100.00 owed across all months" }).getAttribute("href")).toBe("/owed");
    expect(screen.getByRole("link", { name: "Invoices" }).getAttribute("href")).toBe("/invoices");
  });

  test("with nothing owed, says nothing about it", async () => {
    const { Home } = await import("./Home.js");
    render(<Home setup={setup} owedToea={0} onSignOut={vi.fn()} />);
    expect(screen.queryByText(/owed/)).toBeNull();
  });
});
