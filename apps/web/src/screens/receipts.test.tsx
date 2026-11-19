/** G2b web (docs/test-lists/general-g2.md): Still owed with payments, the payment form, the payments list. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { type CalendarDate, type PaymentInput, type Period, type Toea, arrears } from "@sasimem/core";
import { type Mock, describe, expect, test, vi } from "vitest";
import type { Outcome, OwedInvoice, PaymentRow, Setup } from "../setup.js";
import { Home } from "./Home.js";
import { Owed } from "./Owed.js";
import { PaymentForm } from "./PaymentForm.js";
import { Payments } from "./Payments.js";

const today = "2026-11-19" as CalendarDate;
const k = (n: number) => n as Toea;
const type = (label: RegExp | string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

const setup = (features?: object): Setup => ({
  org: {
    name: "Wari Electrical", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
    bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto", ...(features === undefined ? {} : { features }),
  },
  properties: [], tenancies: [], templates: [],
  tenants: [{ id: "c1", name: "Kila Trading", email: "accounts@kila.example", phone: "" }, { id: "c2", name: "Mine Services", email: "ap@mine.example", phone: "" }],
});
const ON = { rentals: true, repeating: true, oneOff: true };

const owed = (over: Partial<OwedInvoice>): OwedInvoice => ({
  id: "a", tenantId: "c1", tenantName: "Kila Trading", number: "INV-0001", period: "2026-11" as Period, status: "sent",
  dueDate: "2026-11-30" as CalendarDate, totalToea: k(10_000), ...over,
});
const a = owed({ id: "a", number: "INV-0001", dueDate: "2026-11-01" as CalendarDate, totalToea: k(10_000), amountPaidToea: k(4_000) });
const b = owed({ id: "b", number: "INV-0002", dueDate: "2026-11-30" as CalendarDate, totalToea: k(5_000) });
const other = owed({ id: "x", tenantId: "c2", tenantName: "Mine Services", number: "INV-0003" });

test("Home shows Payments only with one-off invoicing", () => {
  const { unmount } = render(<Home setup={setup()} onSignOut={vi.fn()} />);
  expect(screen.queryByRole("link", { name: "Payments" })).toBeNull();
  unmount();
  render(<Home setup={setup(ON)} onSignOut={vi.fn()} />);
  expect(screen.getByRole("link", { name: "Payments" }).getAttribute("href")).toBe("/payments");
});

describe("Still owed, with payments", () => {
  test("balances, what was paid, Part paid, credit, and Record a payment per customer; no paid tick on a part-paid invoice", () => {
    render(<Owed groups={arrears([a, b])} today={today} onMarkPaid={vi.fn()} payments credit={new Map([["c1", 2_500]])} />);
    expect(screen.getByText("K110.00 owed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Kila Trading · K110.00" })).toBeTruthy();
    expect(screen.getByText("K40.00 paid · K60.00 left")).toBeTruthy();
    expect(screen.getByText("K25.00 in credit")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Record a payment from Kila Trading" }).getAttribute("href")).toBe("/payments/new?customer=c1");
    expect(screen.queryByRole("button", { name: "Mark INV-0001 paid" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark INV-0002 paid" })).toBeTruthy();
    expect(screen.getByText(/due 30 November 2026 · Not paid/)).toBeTruthy();
  });

  test("a Rentals-only org sees it as before", () => {
    render(<Owed groups={arrears([b])} today={today} onMarkPaid={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /record a payment/i })).toBeNull();
  });
});

describe("the payment form", () => {
  type Record_ = (id: string, p: PaymentInput, email: boolean) => Promise<Outcome>;
  const form = (over: { customerId?: string; onRecord?: Mock<Record_> } = {}) => {
    const onRecord = over.onRecord ?? vi.fn<Record_>().mockResolvedValue({ ok: true, message: "Recorded K80.00 from Kila Trading: receipt RCT-0001. Emailed to accounts@kila.example." });
    render(<PaymentForm setup={setup(ON)} owed={[b, a, other]} today={today} paymentId="pay1" credit={new Map([["c1", 2_500]])}
      {...(over.customerId === undefined ? {} : { customerId: over.customerId })} onRecord={onRecord} />);
    return onRecord;
  };
  const applied = (n: string) => (screen.getByLabelText(new RegExp(`^Apply to ${n}`)) as HTMLInputElement).value;

  test("proposes oldest first as the amount is typed, and shows credit for what is left", () => {
    form({ customerId: "c1" });
    expect(screen.getByText("They already have K25.00 in credit.")).toBeTruthy();
    expect(screen.queryByLabelText(/^Apply to INV-0003/)).toBeNull(); // another customer's
    type(/amount received/i, "K80");
    expect([applied("INV-0001"), applied("INV-0002")]).toEqual(["K60.00", "K20.00"]);
    type(/amount received/i, "K150");
    expect([applied("INV-0001"), applied("INV-0002")]).toEqual(["K60.00", "K50.00"]);
    expect(screen.getByText("K40.00 is more than this pays. It will be kept as credit for them.")).toBeTruthy();
  });

  test("the owner can change where it goes, and go back to oldest first", () => {
    form({ customerId: "c1" });
    type(/amount received/i, "K80");
    type(/^Apply to INV-0001/, "");
    type(/^Apply to INV-0002/, "K50");
    expect(screen.getByText("K30.00 is more than this pays. It will be kept as credit for them.")).toBeTruthy();
    type(/amount received/i, "K90"); // typed allocations stay put
    expect(applied("INV-0002")).toBe("K50"); // as typed
    click("Apply oldest first again");
    expect([applied("INV-0001"), applied("INV-0002")]).toEqual(["K60.00", "K30.00"]);
  });

  test("records what was typed, under the form's payment ID, with or without the receipt email", async () => {
    const onRecord = form({ customerId: "c1" });
    type(/amount received/i, "K80");
    type(/received on/i, "2026-11-18");
    fireEvent.change(screen.getByLabelText(/how it was paid/i), { target: { value: "cash" } });
    type(/their reference/i, " Counter 2 ");
    fireEvent.click(screen.getByLabelText(/email them a receipt/i));
    click("Record payment");
    expect(await screen.findByText(/receipt RCT-0001/)).toBeTruthy();
    expect(onRecord).toHaveBeenCalledWith("pay1", {
      customerId: "c1", receivedOn: "2026-11-18", amountToea: 8_000, method: "cash", reference: "Counter 2", note: "",
      allocations: [{ invoiceId: "a", amountToea: 6_000 }, { invoiceId: "b", amountToea: 2_000 }],
    }, false);
  });

  test("problems in core's words, and nothing recorded", () => {
    const onRecord = form();
    click("Record payment");
    expect(screen.getByText("Choose who paid.")).toBeTruthy();
    expect(screen.getByText("Enter the amount received.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/who paid/i), { target: { value: "c1" } });
    type(/amount received/i, "K10");
    type(/^Apply to INV-0001/, "");
    type(/^Apply to INV-0002/, "K30");
    click("Record payment");
    expect(screen.getByText("You have applied K30.00, more than the K10.00 received.")).toBeTruthy();
    type(/^Apply to INV-0002/, "lots");
    click("Record payment");
    expect(within(screen.getByLabelText(/^Apply to INV-0002/).closest("label") as HTMLElement).getByText("Enter an amount like K1,200.00.")).toBeTruthy();
    type(/received on/i, "2026-11-20");
    click("Record payment");
    expect(screen.getByText("A payment cannot be received in the future.")).toBeTruthy();
    expect(onRecord).not.toHaveBeenCalled();
  });

  test("choosing another customer shows their invoices; one who owes nothing gets it all as credit", () => {
    const { unmount } = render(<PaymentForm setup={setup(ON)} owed={[a, b, other]} today={today} paymentId="p" onRecord={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/who paid/i), { target: { value: "c2" } });
    expect(screen.getByLabelText(/^Apply to INV-0003/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Apply to INV-0001/)).toBeNull();
    unmount();
    render(<PaymentForm setup={setup(ON)} owed={[]} today={today} paymentId="p" customerId="c1" onRecord={vi.fn()} />);
    expect(screen.getByText("This customer owes nothing now. The whole amount will be kept as credit.")).toBeTruthy();
  });

  test("a failure says so and keeps what was typed", async () => {
    form({ customerId: "c1", onRecord: vi.fn<Record_>().mockResolvedValue({ ok: false, message: "You need a connection to do this." }) });
    type(/amount received/i, "K10");
    click("Record payment");
    expect(await screen.findByText("You need a connection to do this.")).toBeTruthy();
    expect((screen.getByLabelText(/amount received/i) as HTMLInputElement).value).toBe("K10");
  });
});

describe("the payments list", () => {
  const rows: PaymentRow[] = [
    { id: "p2", receiptNumber: "RCT-0002", customerId: "c1", customerName: "Kila Trading", receivedOn: "2026-11-19" as CalendarDate, amountToea: k(15_000), method: "bank", reference: "TRF 77",
      allocations: [{ number: "INV-0001", amountToea: k(6_000) }], creditToea: k(9_000), status: "recorded", undoReason: "" },
    { id: "p1", receiptNumber: "RCT-0001", customerId: "c1", customerName: "Kila Trading", receivedOn: "2026-11-18" as CalendarDate, amountToea: k(1_000), method: "cash", reference: "",
      allocations: [], creditToea: k(1_000), status: "undone", undoReason: "Entered twice" },
  ];

  test("receipt number, customer, amount, where it went; undone ones marked", () => {
    render(<Payments payments={rows} onUndo={vi.fn()} onResend={vi.fn()} />);
    expect(screen.getByText(/19 November 2026 · Bank transfer · TRF 77 · paid INV-0001 K60.00 · K90.00 credit/)).toBeTruthy();
    expect(screen.getByText("Entered twice")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo RCT-0001" })).toBeNull();
  });

  test("undo asks for a reason, then undoes", async () => {
    const onUndo = vi.fn().mockResolvedValue({ ok: true, message: "Payment undone. Its invoices owe what they did before it." });
    render(<Payments payments={rows} onUndo={onUndo} onResend={vi.fn()} />);
    click("Undo RCT-0002");
    click("Undo this payment");
    expect(screen.getByText("Say why this payment is being undone.")).toBeTruthy();
    type(/why undo RCT-0002/i, "Wrong customer");
    click("Undo this payment");
    expect(await screen.findByText("Payment undone. Its invoices owe what they did before it.")).toBeTruthy();
    expect(onUndo).toHaveBeenCalledWith("p2", "Wrong customer");
  });

  test("email a receipt again", async () => {
    const onResend = vi.fn().mockResolvedValue({ ok: true, message: "Emailed receipt RCT-0002 to accounts@kila.example again." });
    render(<Payments payments={rows} onUndo={vi.fn()} onResend={onResend} />);
    click("Email RCT-0002 again");
    expect(await screen.findByText("Emailed receipt RCT-0002 to accounts@kila.example again.")).toBeTruthy();
    await waitFor(() => expect(onResend).toHaveBeenCalledWith("p2"));
  });
});
