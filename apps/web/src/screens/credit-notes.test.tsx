/** G2c web (docs/test-lists/general-g2.md): the credit note form and list, the links to it, and using credit. */
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { type CalendarDate, type CreditNoteInput, type Line, type Period, type Toea, arrears } from "@sasimem/core";
import { type Mock, describe, expect, test, vi } from "vitest";
import type { CreditNoteRow, CreditableRow, Month, OneOffs as List, Outcome, OwedInvoice, Setup } from "../setup.js";
import { CreditNoteForm } from "./CreditNoteForm.js";
import { CreditNotes } from "./CreditNotes.js";
import { Home } from "./Home.js";
import { OneOffs } from "./OneOffs.js";
import { Owed } from "./Owed.js";
import { PaymentForm } from "./PaymentForm.js";
import { Tracking } from "./Tracking.js";

const today = "2026-11-19" as CalendarDate;
const k = (n: number) => n as Toea;
const type = (label: RegExp | string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const field = (label: RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;

const setup = (): Setup => ({
  org: {
    name: "Wari Electrical", address: "Boroko", email: "mary@wari.example", gstRegistered: true, gstNumber: "500012345",
    bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto", features: { rentals: true, repeating: true, oneOff: true },
  },
  properties: [], tenancies: [], templates: [],
  tenants: [{ id: "c1", name: "Kila Trading", email: "accounts@kila.example", phone: "" }],
});

const line = (description: string, amount: number, taxed: boolean): Line => ({
  kind: "item", description, detail: "", amountToea: k(amount), gstApplicable: taxed, gstToea: k(taxed ? amount / 10 : 0),
});
/** Labour K200 + GST and parts K50 exempt: K270.00. */
const invoice = (over: Partial<CreditableRow> = {}): CreditableRow => ({
  id: "d1", number: "INV-0007", customerName: "Kila Trading", status: "sent", documentTitle: "TAX INVOICE",
  lines: [line("Labour", 20_000, true), line("Parts", 5_000, false)], totalToea: k(27_000), ...over,
});

describe("the credit note form", () => {
  type Issue = (id: string, input: CreditNoteInput, emailIt: boolean) => Promise<Outcome>;
  const form = (inv = invoice(), onIssue: Mock<Issue> = vi.fn<Issue>().mockResolvedValue({ ok: true, message: "Issued CN-0001 for INV-0007, crediting Kila Trading. Emailed to accounts@kila.example." })) => {
    render(<CreditNoteForm invoice={inv} creditNoteId="cn1" onIssue={onIssue} />);
    return onIssue;
  };

  test("each line with what is left; GST and total as typed; where it goes", () => {
    form(invoice({ amountPaidToea: k(25_000), creditNotedLines: [{ amountToea: k(5_000), gstToea: k(500) }, { amountToea: k(0), gstToea: k(0) }], creditNotedToea: k(5_500), creditedToea: k(0) }));
    expect(screen.getByRole("heading", { name: "Credit INV-0007 · Kila Trading" })).toBeTruthy();
    expect(screen.getByText("K150.00 of K200.00 left to credit.")).toBeTruthy();
    type(/^Credit on Labour/, "K100");
    type(/^Credit on Parts/, "K10");
    expect(screen.getByText("Credit note K120.00 (GST K10.00)")).toBeTruthy();
    // K270 less K250 paid: K20 is owed, so K20 comes off and the rest is credit.
    expect(screen.getByText("K20.00 comes off what INV-0007 owes.")).toBeTruthy();
    expect(screen.getByText("K100.00 is kept as credit for Kila Trading, for their next invoice.")).toBeTruthy();
  });

  test("Credit the whole invoice fills in every line's remainder; issuing sends what was typed, with the reason", async () => {
    const onIssue = form();
    click("Credit the whole invoice");
    expect([field(/^Credit on Labour/), field(/^Credit on Parts/)]).toEqual(["K200.00", "K50.00"]);
    type(/^Reason/, " Job cancelled ");
    fireEvent.click(screen.getByLabelText(/email it to them/i));
    click("Issue credit note");
    expect(await screen.findByText(/Issued CN-0001/)).toBeTruthy();
    expect(onIssue).toHaveBeenCalledWith("cn1", { invoiceId: "d1", reason: "Job cancelled", lines: [{ lineIndex: 0, amountToea: 20_000 }, { lineIndex: 1, amountToea: 5_000 }] }, false);
  });

  test("problems in core's words, and nothing issued", () => {
    const onIssue = form();
    click("Issue credit note");
    expect(screen.getByText("Choose what to credit.")).toBeTruthy();
    expect(screen.getByText("Say why you are crediting this invoice. It prints on the credit note.")).toBeTruthy();
    type(/^Credit on Parts/, "K60");
    click("Issue credit note");
    expect(screen.getByText('Only K50.00 of "Parts" is left to credit.')).toBeTruthy();
    type(/^Credit on Parts/, "some");
    click("Issue credit note");
    expect(screen.getByText("Enter an amount like K1,200.00.")).toBeTruthy();
    expect(onIssue).not.toHaveBeenCalled();
  });

  test("a line credited in full, an invoice credited in full, and a failure that keeps what was typed", async () => {
    const { unmount } = render(<CreditNoteForm invoice={invoice({ creditNotedToea: k(27_000) })} creditNoteId="cn1" onIssue={vi.fn()} />);
    expect(screen.getByText("INV-0007 has been credited in full already.")).toBeTruthy();
    unmount();
    form(invoice({ creditNotedLines: [{ amountToea: k(0), gstToea: k(0) }, { amountToea: k(5_000), gstToea: k(0) }], creditNotedToea: k(5_000) }),
      vi.fn<Issue>().mockResolvedValue({ ok: false, message: "You need a connection to do this." }));
    expect(screen.getByText("Parts: credited in full already.")).toBeTruthy();
    type(/^Credit on Labour/, "K10");
    type(/^Reason/, "Overcharged");
    click("Issue credit note");
    expect(await screen.findByText("You need a connection to do this.")).toBeTruthy();
    expect(field(/^Credit on Labour/)).toBe("K10");
  });
});

describe("the credit notes list", () => {
  const rows: CreditNoteRow[] = [{ id: "cn1", number: "CN-0001", invoiceNumber: "INV-0007", customerName: "Kila Trading", issueDate: today, reason: "Job cancelled", totalToea: k(12_000), appliedToea: k(2_000), creditToea: k(10_000) }];

  test("number, invoice, customer, amount, where it went; Open PDF and Email again", async () => {
    const onResend = vi.fn().mockResolvedValue({ ok: true, message: "Emailed CN-0001 to accounts@kila.example again." });
    const onOpenPdf = vi.fn().mockResolvedValue({ ok: true, message: "" });
    render(<CreditNotes creditNotes={rows} onOpenPdf={onOpenPdf} onResend={onResend} />);
    expect(screen.getByText(/for INV-0007 · 19 November 2026 · Job cancelled · K20.00 off the invoice · K100.00 kept as credit/)).toBeTruthy();
    click("Open the PDF of CN-0001");
    await waitFor(() => expect(onOpenPdf).toHaveBeenCalledWith("cn1"));
    click("Email CN-0001 again");
    expect(await screen.findByText("Emailed CN-0001 to accounts@kila.example again.")).toBeTruthy();
  });

  test("none yet", () => {
    render(<CreditNotes creditNotes={[]} onOpenPdf={vi.fn()} onResend={vi.fn()} />);
    expect(screen.getByText("No credit notes yet.")).toBeTruthy();
  });
});

describe("links to a credit note, and what was credited", () => {
  const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

  test("Home has Credit notes with one-off invoicing", () => {
    render(<Home setup={setup()} onSignOut={vi.fn()} />);
    expect(href("Credit notes")).toBe("/credit-notes");
  });

  test("the one-off list: on sent and paid invoices not credited in full; what was credited", () => {
    const list: List = { drafts: [], invoices: [
      { id: "a", number: "INV-0002", customerName: "Kila Trading", issueDate: today, dueDate: "2026-12-03" as CalendarDate, totalToea: k(10_000), status: "sent", creditedToea: k(3_000), creditNotedToea: k(3_000) },
      { id: "b", number: "INV-0001", customerName: "Kila Trading", issueDate: today, dueDate: "2026-12-03" as CalendarDate, totalToea: k(10_000), status: "paid", creditNotedToea: k(10_000) },
    ] };
    render(<OneOffs list={list} setup={setup()} today={today} onOpenPdf={vi.fn()} />);
    expect(href("Credit note for INV-0002")).toBe("/credit-notes/new?invoice=a");
    expect(screen.queryByRole("link", { name: "Credit note for INV-0001" })).toBeNull();
    expect(screen.getByText(/K100.00 · K30.00 credited · K70.00 left/)).toBeTruthy();
    expect(screen.getByText(/Credited$/)).toBeTruthy();
  });

  test("Still owed: what was credited, a link per invoice, and no paid tick once credited", () => {
    const i: OwedInvoice = { id: "a", tenantId: "c1", tenantName: "Kila Trading", number: "INV-0002", period: "2026-11" as Period, status: "sent", dueDate: "2026-12-03" as CalendarDate, totalToea: k(10_000), creditedToea: k(3_000), creditNotedToea: k(3_000) };
    render(<Owed groups={arrears([i])} today={today} onMarkPaid={vi.fn()} payments />);
    expect(screen.getByText("K30.00 credited · K70.00 left")).toBeTruthy();
    expect(href("Credit note for INV-0002")).toBe("/credit-notes/new?invoice=a");
    expect(screen.queryByRole("button", { name: "Mark INV-0002 paid" })).toBeNull();
  });

  test("a sent month's invoices: a link with credit notes on; no tick or void once credited", () => {
    const month: Month = {
      period: "2026-11" as Period, status: "sent", sendAt: new Date(), totalToea: k(10_000), invoiceCount: 1,
      invoices: [{ id: "r1", tenantName: "Kila Trading", unitLabel: "Shop 1", status: "sent", rentToea: k(10_000), totalToea: k(10_000), number: "INV-0003", dueDate: "2026-12-03" as CalendarDate, creditedToea: k(1_000), creditNotedToea: k(1_000) }],
    };
    const done = vi.fn().mockResolvedValue({ ok: true, message: "" });
    render(<Tracking month={month} today={today} creditNotes onMarkPaid={done} onMarkUnpaid={done} onPauseReminders={done} onVoid={done} onResend={done} onOpenPdf={done} />);
    expect(href("Credit note for INV-0003")).toBe("/credit-notes/new?invoice=r1");
    expect(screen.queryByRole("button", { name: "Mark INV-0003 paid" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void INV-0003…" })).toBeNull();
  });
});

describe("using credit in the payment form", () => {
  const owed: OwedInvoice = { id: "a", tenantId: "c1", tenantName: "Kila Trading", number: "INV-0002", period: "2026-11" as Period, status: "sent", dueDate: "2026-12-03" as CalendarDate, totalToea: k(10_000) };

  test("their credit pays first, with or without money received", async () => {
    const onRecord = vi.fn().mockResolvedValue({ ok: true, message: "Used K25.00 of Kila Trading's credit." });
    render(<PaymentForm setup={setup()} owed={[owed]} today={today} paymentId="p1" customerId="c1" credit={new Map([["c1", 2_500]])} onRecord={onRecord} />);
    fireEvent.click(screen.getByLabelText(/use their credit as well/i));
    expect(field(/^Apply to INV-0002/)).toBe("K25.00");
    expect(screen.getByText("K25.00 of their credit is used.")).toBeTruthy();
    type(/amount received/i, "K75");
    expect(field(/^Apply to INV-0002/)).toBe("K100.00");
    type(/amount received/i, "");
    click("Record payment");
    expect(await screen.findByText(/Used K25.00/)).toBeTruthy();
    expect(onRecord).toHaveBeenCalledWith("p1", expect.objectContaining({ amountToea: 0, creditUsedToea: 2_500, allocations: [{ invoiceId: "a", amountToea: 2_500 }] }), true);
  });
});
