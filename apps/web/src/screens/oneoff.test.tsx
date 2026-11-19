/** G2a web (docs/test-lists/general-g2.md): the price list, the invoice editor and its list, behind the `oneOff` feature. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import type { CalendarDate, Item, OneOffDraft, Toea } from "@sasimem/core";
import { type Mock, describe, expect, test, vi } from "vitest";
import type { OneOffs as List, Outcome, ScheduledDraft, Setup, WithId } from "../setup.js";
import { Home } from "./Home.js";
import { InvoiceEditor } from "./InvoiceEditor.js";
import { ItemForm, Items } from "./Items.js";
import { OneOffs } from "./OneOffs.js";
import { Settings } from "./Settings.js";
import { TenantForm } from "./TenantForm.js";

const today = "2026-11-19" as CalendarDate;
const type = (label: RegExp | string, value: string, within_: HTMLElement = document.body) =>
  fireEvent.input(within(within_).getByLabelText(label), { target: { value } });
const choose = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const line = (n: number) => screen.getByRole("group", { name: `Line ${n}` });

const ON = { rentals: true, repeating: true, oneOff: true };
const labour: WithId<Item> = { id: "i1", name: "Labour", description: "Electrician", unit: "hour", unitPriceToea: 8_000 as Toea, taxCode: "standard" };
const cable: WithId<Item> = { id: "i2", name: "Cable 2.5mm", description: "", unit: "m", unitPriceToea: 450 as Toea, taxCode: "exempt" };

const setup = (over: { gst?: boolean; features?: object | undefined; defaultTermsDays?: number } = {}): Setup => ({
  org: {
    name: "Wari Electrical", address: "Boroko", email: "mary@wari.example", gstRegistered: over.gst ?? true, gstNumber: over.gst === false ? "" : "500012345",
    bankName: "BSP", bankAccount: "1000 2345", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto",
    ...("features" in over ? (over.features === undefined ? {} : { features: over.features }) : { features: ON }),
    ...(over.defaultTermsDays === undefined ? {} : { defaultTermsDays: over.defaultTermsDays }),
  },
  properties: [],
  tenants: [
    { id: "c1", name: "Kila Trading", email: "accounts@kila.example", phone: "" },
    { id: "c2", name: "Mine Services", email: "ap@mine.example", phone: "", poRequired: true, termsDays: 30, ccEmails: ["boss@mine.example"] } as WithId<{ name: string; email: string; phone: string }>,
  ],
  tenancies: [],
  templates: [],
  items: [labour, cable],
});

describe("the menu shows one-off invoicing only when the org has it", () => {
  const titles = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));

  test("a Rentals org (no features stored) sees today's menu", () => {
    render(<Home setup={setup({ features: undefined })} onSignOut={vi.fn()} />);
    expect(titles()).not.toContain("/one-off");
    expect(titles()).not.toContain("/items");
  });

  test("with oneOff: One-off invoices and Price list first, and rent invoices named as such", () => {
    render(<Home setup={setup()} onSignOut={vi.fn()} />);
    expect(screen.getByRole("link", { name: "One-off invoices" }).getAttribute("href")).toBe("/one-off");
    expect(screen.getByRole("link", { name: "Price list" }).getAttribute("href")).toBe("/items");
    expect(screen.getByRole("link", { name: "Rent invoices" }).getAttribute("href")).toBe("/invoices");
    expect(screen.getByRole("link", { name: "Tenants and customers" }).getAttribute("href")).toBe("/tenants");
  });
});

describe("the price list", () => {
  test("lists each item with its price and unit", () => {
    render(<Items setup={setup()} />);
    expect(screen.getByRole("link", { name: "Labour" }).getAttribute("href")).toBe("/items/i1");
    expect(screen.getByText("K80.00 per hour")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add an item" }).getAttribute("href")).toBe("/items/new");
  });

  test("adding an item reads the price in kina and saves core's shape", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    const onDone = vi.fn();
    render(<ItemForm id={null} setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={onDone} />);
    type(/item name/i, " Call-out fee ");
    type(/^price/i, "K150");
    type(/^unit/i, "each");
    choose(/gst/i, "zero");
    click("Save");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(null, { name: "Call-out fee", description: "", unit: "each", unitPriceToea: 15_000, taxCode: "zero" });
  });

  test("problems are shown in core's words, and nothing is saved", () => {
    const onSave = vi.fn();
    render(<ItemForm id={null} setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={vi.fn()} />);
    type(/^price/i, "lots");
    click("Save");
    expect(screen.getByText("Give the item a name.")).toBeTruthy();
    expect(screen.getByText("Enter an amount like K1,200.00.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("an org not registered for GST is not asked about GST", () => {
    render(<ItemForm id={null} setup={setup({ gst: false })} onSave={vi.fn()} onDelete={vi.fn()} onDone={vi.fn()} />);
    expect(screen.queryByLabelText(/gst/i)).toBeNull();
  });

  test("editing shows what is stored; deleting removes it", async () => {
    const onDelete = vi.fn().mockResolvedValue(null);
    const onDone = vi.fn();
    render(<ItemForm id="i1" setup={setup()} onSave={vi.fn()} onDelete={onDelete} onDone={onDone} />);
    expect((screen.getByLabelText(/^price/i) as HTMLInputElement).value).toBe("K80.00");
    click("Delete this item");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDelete).toHaveBeenCalledWith("i1");
  });
});

describe("the invoice editor", () => {
  type Send = (id: string) => Promise<Outcome>;
  type Schedule = (id: string, sendOn: string) => Promise<Outcome>;
  const editor = (over: { draft?: ScheduledDraft | null; id?: string | null; setup?: Setup; onSend?: Mock<Send>; onSchedule?: Mock<Schedule> } = {}) => {
    const onSave = vi.fn(async (id: string | null, _draft: OneOffDraft) => ({ id: id ?? "d1" }));
    const onSend = over.onSend ?? vi.fn<Send>().mockResolvedValue({ ok: true, message: "Sent INV-0001 to Kila Trading." });
    const onSchedule = over.onSchedule ?? vi.fn<Schedule>().mockResolvedValue({ ok: true, message: "Kila Trading's invoice goes on 1 December 2026 at 8:00 am. It is numbered then." });
    const onCancelSchedule = vi.fn<Send>().mockResolvedValue({ ok: true, message: "It will not be sent. It stays a draft." });
    const onDone = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(null);
    render(<InvoiceEditor id={over.id ?? null} draft={over.draft ?? null} setup={over.setup ?? setup()} today={today}
      onSave={onSave} onSend={onSend} onSchedule={onSchedule} onCancelSchedule={onCancelSchedule} onDelete={onDelete} onDone={onDone} />);
    return { onSave, onSend, onSchedule, onCancelSchedule, onDone, onDelete };
  };
  const total = () => within(screen.getByLabelText("Totals")).getAllByRole("definition").map((d) => d.textContent);

  test("pick a customer, add a line from the price list and type another; totals and GST follow as you type", () => {
    editor();
    choose(/customer/i, "c1");
    choose(/add from your price list/i, "i1"); // fills the blank line a new invoice starts with
    expect(within(line(1)).getByLabelText("What for")).toHaveProperty("value", "Labour");
    expect(within(line(1)).getByLabelText("Price each")).toHaveProperty("value", "K80.00");
    type("Quantity", "1.5", line(1));
    click("Add a line");
    type("What for", "Site visit", line(2));
    type("Price each", "K50", line(2));
    // K50.00 + 1.5 × K80.00 = K170.00; GST 10% = K17.00.
    expect(total()).toEqual(["K170.00", "K17.00", "K187.00"]);
    choose(/add from your price list/i, "i2"); // exempt: no GST
    type("Quantity", "30", line(3));
    expect(total()).toEqual(["K305.00", "K17.00", "K322.00"]);
  });

  test("without GST registration there is no GST row or question", () => {
    editor({ setup: setup({ gst: false }) });
    expect(within(screen.getByLabelText("Totals")).queryByText("GST")).toBeNull();
    expect(within(line(1)).queryByLabelText("GST")).toBeNull();
  });

  test("Send with problems shows them in core's words and sends nothing", () => {
    const { onSave, onSend } = editor();
    type("Quantity", "abc", line(1));
    click("Send invoice");
    expect(screen.getByText("Choose who this invoice is for.")).toBeTruthy();
    expect(within(line(1)).getByText("Say what this line is for.")).toBeTruthy();
    expect(within(line(1)).getByText("Enter a number, like 1 or 2.5.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  test("a customer who pays only against an order number: it says so, and Send asks for it", () => {
    editor();
    choose(/customer/i, "c2");
    expect(screen.getByText(/copy to boss@mine.example\. Pays only against an order number\./)).toBeTruthy();
    expect(screen.getByLabelText(/days to pay/i).closest("label")?.textContent).toContain("Leave blank for this customer's 30 days.");
    type("What for", "Survey", line(1));
    type("Price each", "K10", line(1));
    click("Send invoice");
    expect(screen.getByText("This customer pays only against an order number. Enter it.")).toBeTruthy();
  });

  test("Send saves the draft, then sends it, and says so", async () => {
    const { onSave, onSend } = editor();
    choose(/customer/i, "c1");
    type("What for", "Rewire kitchen", line(1));
    type("Detail (optional)", "Labour and parts", line(1));
    type("Quantity", "2", line(1));
    type("Unit", "hour", line(1));
    type("Price each", "K80", line(1));
    type(/order number/i, " PO-7731 ");
    type(/days to pay/i, "7");
    type(/note on the invoice/i, "Thank you.");
    click("Send invoice");
    expect(await screen.findByText("Sent INV-0001 to Kila Trading.")).toBeTruthy();
    expect(onSave).toHaveBeenCalledWith(null, {
      customerId: "c1", poNumber: "PO-7731", notes: "Thank you.", dueDays: 7,
      lines: [{ description: "Rewire kitchen", detail: "Labour and parts", quantityMilli: 2000, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" }],
    });
    expect(onSend).toHaveBeenCalledWith("d1");
    expect(screen.getByRole("link", { name: "Write another invoice" }).getAttribute("href")).toBe("/one-off/new");
  });

  test("if sending fails, the message shows and the draft is kept: the next try saves the same draft", async () => {
    const onSend = vi.fn<Send>().mockResolvedValueOnce({ ok: false, message: "You need a connection to do this." }).mockResolvedValue({ ok: true, message: "Sent INV-0001 to Kila Trading." });
    const { onSave } = editor({ onSend });
    choose(/customer/i, "c1");
    type("What for", "Repair", line(1));
    type("Price each", "K10", line(1));
    click("Send invoice");
    expect(await screen.findByText("You need a connection to do this.")).toBeTruthy();
    click("Send invoice");
    await screen.findByText("Sent INV-0001 to Kila Trading.");
    expect(onSave.mock.calls.map((c) => c[0])).toEqual([null, "d1"]);
  });

  test("Save draft keeps an unfinished invoice (no customer yet) and goes back to the list", async () => {
    const { onSave, onDone } = editor();
    type("What for", "Half done", line(1));
    type("Price each", "K25", line(1));
    click("Save draft");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(null, expect.objectContaining({ customerId: "", lines: [expect.objectContaining({ description: "Half done", quantityMilli: 1000 })] }));
  });

  test("Save draft refuses numbers it cannot read, so a draft never stores nonsense", () => {
    const { onSave } = editor();
    type("Price each", "ten kina", line(1));
    click("Save draft");
    expect(within(line(1)).getByText("Enter an amount like K1,200.00.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a saved draft opens as it was, and can be deleted", async () => {
    const draft: OneOffDraft = {
      customerId: "c1", poNumber: "PO-1", notes: "", dueDays: null,
      lines: [{ description: "Labour", detail: "", quantityMilli: 1500, unit: "hour", unitPriceToea: 8_000 as Toea, taxCode: "standard" }],
    };
    const { onDelete, onDone } = editor({ id: "d9", draft });
    expect(within(line(1)).getByLabelText("Quantity")).toHaveProperty("value", "1.5");
    expect(screen.getByLabelText(/customer/i)).toHaveProperty("value", "c1");
    expect(total()).toEqual(["K120.00", "K12.00", "K132.00"]);
    click("Delete this draft");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDelete).toHaveBeenCalledWith("d9");
  });

  // The 30-line cap is core's and the rules' (T1, T2); rendering 30 lines here passes a T1 test's CPU budget.
  test("lines can be removed, but not the last one", () => {
    const draft: OneOffDraft = {
      customerId: "", poNumber: "", notes: "", dueDays: null,
      lines: ["first", "second"].map((description) => ({ description, detail: "", quantityMilli: 1000, unit: "", unitPriceToea: 100 as Toea, taxCode: "standard" as const })),
    };
    editor({ id: "d1", draft });
    click("Remove line 1");
    expect(within(line(1)).getByLabelText("What for")).toHaveProperty("value", "second");
    expect(screen.queryByRole("button", { name: /remove line/i })).toBeNull();
  });

  test("the hint names the org's usual terms when the customer has none", () => {
    editor({ setup: setup({ defaultTermsDays: 21 }) });
    choose(/customer/i, "c1");
    expect(screen.getByLabelText(/days to pay/i).closest("label")?.textContent).toContain("Leave blank for your usual 21 days.");
  });
});

describe("send later (G2d)", () => {
  type Send = (id: string) => Promise<Outcome>;
  type Schedule = (id: string, sendOn: string) => Promise<Outcome>;
  const ready: OneOffDraft = {
    customerId: "c1", poNumber: "", notes: "", dueDays: null,
    lines: [{ description: "Labour", detail: "", quantityMilli: 1000, unit: "hour", unitPriceToea: 8_000 as Toea, taxCode: "standard" }],
  };
  const editor = (draft: ScheduledDraft | null, id: string | null = "d1") => {
    const onSave = vi.fn(async (i: string | null, _d: OneOffDraft) => ({ id: i ?? "d1" }));
    const onSchedule = vi.fn<Schedule>().mockResolvedValue({ ok: true, message: "Kila Trading's invoice goes on 1 December 2026 at 8:00 am. It is numbered then." });
    const onCancelSchedule = vi.fn<Send>().mockResolvedValue({ ok: true, message: "It will not be sent. It stays a draft." });
    const onSend = vi.fn<Send>();
    render(<InvoiceEditor id={id} draft={draft} setup={setup()} today={today}
      onSave={onSave} onSend={onSend} onSchedule={onSchedule} onCancelSchedule={onCancelSchedule} onDelete={vi.fn()} onDone={vi.fn()} />);
    return { onSave, onSchedule, onCancelSchedule, onSend };
  };

  test("Schedule saves the draft, then schedules it for the day chosen, and says so", async () => {
    const { onSave, onSchedule, onSend } = editor(ready);
    expect(screen.getByLabelText(/send on/i).closest("label")?.textContent).toContain("It goes at 8:00 am that day, the hour you send invoices.");
    type(/send on/i, "2026-12-01");
    click("Schedule");
    expect(await screen.findByText("Kila Trading's invoice goes on 1 December 2026 at 8:00 am. It is numbered then.")).toBeTruthy();
    expect(onSave).toHaveBeenCalledWith("d1", ready);
    expect(onSchedule).toHaveBeenCalledWith("d1", "2026-12-01");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Scheduled" })).toBeTruthy();
  });

  test("the day's problems in core's words, and a draft that could not be sent: nothing saved or scheduled", () => {
    const { onSave, onSchedule } = editor(ready);
    click("Schedule");
    expect(screen.getByText("Choose the day to send it.")).toBeTruthy();
    type(/send on/i, "2026-11-19");
    click("Schedule");
    expect(screen.getByText("Choose a day after today. To send it today, press Send invoice.")).toBeTruthy();
    choose(/customer/i, "");
    type(/send on/i, "2026-12-01");
    click("Schedule");
    expect(screen.getByText("Choose who this invoice is for.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(onSchedule).not.toHaveBeenCalled();
  });

  test("a scheduled draft says when it goes; Cancel the schedule drops it", async () => {
    const { onCancelSchedule } = editor({ ...ready, sendLater: { sendOn: "2026-12-01" as CalendarDate } });
    expect(screen.getByText("Scheduled: it goes to Kila Trading on 1 December 2026 at 8:00 am. It is numbered then.")).toBeTruthy();
    expect(screen.getByLabelText(/send on/i)).toHaveProperty("value", "2026-12-01");
    click("Cancel the schedule");
    expect(await screen.findByText("It will not be sent. It stays a draft.")).toBeTruthy();
    expect(onCancelSchedule).toHaveBeenCalledWith("d1");
    expect(screen.queryByRole("button", { name: "Cancel the schedule" })).toBeNull();
  });

  test("saving a scheduled draft checks it as Send would, so a schedule never sits on a draft that cannot go", () => {
    const { onSave } = editor({ ...ready, sendLater: { sendOn: "2026-12-01" as CalendarDate } });
    type("What for", "", line(1));
    click("Save draft");
    expect(within(line(1)).getByText("Say what this line is for.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a draft the tick could not send says why", () => {
    editor({ ...ready, sendLater: { sendOn: "2026-12-01" as CalendarDate, problem: "This customer pays only against an order number. Enter it." } });
    expect(screen.getByRole("alert").textContent).toBe("This was due to go on 1 December 2026 at 8:00 am, but was not sent: This customer pays only against an order number. Enter it. Put it right, then send it or schedule it again.");
    expect(screen.getByRole("button", { name: "Cancel the schedule" })).toBeTruthy();
  });

  test("the list marks scheduled drafts with their day, and ones that could not go", () => {
    const list: List = {
      drafts: [
        { id: "d1", ...ready, sendLater: { sendOn: "2026-12-01" as CalendarDate } },
        { id: "d2", ...ready, customerId: "c2", sendLater: { sendOn: "2026-11-18" as CalendarDate, problem: "Choose who this invoice is for." } },
      ],
      invoices: [],
    };
    render(<OneOffs list={list} setup={setup()} today={today} onOpenPdf={vi.fn()} />);
    expect(screen.getByText(/Goes on 1 December 2026 at 8:00 am/)).toBeTruthy();
    expect(screen.getByText(/Not sent on 18 November 2026: Choose who this invoice is for\./)).toBeTruthy();
  });
});

describe("the list of one-off invoices", () => {
  const list: List = {
    drafts: [{ id: "d1", customerId: "c1", poNumber: "", notes: "", dueDays: null, lines: [{ description: "Labour", detail: "", quantityMilli: 2000, unit: "hour", unitPriceToea: 8_000 as Toea, taxCode: "standard" }] }],
    invoices: [
      { id: "x2", number: "INV-0002", customerName: "Mine Services", issueDate: "2026-11-01" as CalendarDate, dueDate: "2026-11-15" as CalendarDate, totalToea: 50_000 as Toea, status: "sent" },
      { id: "x1", number: "INV-0001", customerName: "Kila Trading", issueDate: "2026-10-01" as CalendarDate, dueDate: "2026-12-01" as CalendarDate, totalToea: 17_600 as Toea, status: "paid" },
    ],
  };

  test("drafts link to the editor with their total; sent invoices show their state, and open their PDF", async () => {
    const onOpenPdf = vi.fn().mockResolvedValue({ ok: false, message: "That PDF could not be opened." });
    render(<OneOffs list={list} setup={setup()} today={today} onOpenPdf={onOpenPdf} />);
    expect(screen.getByRole("link", { name: "Kila Trading" }).getAttribute("href")).toBe("/one-off/d1");
    expect(screen.getByText(/1 line K176.00/)).toBeTruthy();
    expect(screen.getByText(/K500.00 · due .* · Overdue/)).toBeTruthy();
    expect(screen.getByText(/K176.00 · due .* · Paid/)).toBeTruthy();
    click("Open the PDF of INV-0002");
    expect(await screen.findByText("That PDF could not be opened.")).toBeTruthy();
    expect(onOpenPdf).toHaveBeenCalledWith("x2");
  });

  test("nothing sent yet", () => {
    render(<OneOffs list={{ drafts: [], invoices: [] }} setup={setup()} today={today} onOpenPdf={vi.fn()} />);
    expect(screen.getByText("Nothing sent yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New invoice" }).getAttribute("href")).toBe("/one-off/new");
  });
});

describe("Settings: the default payment terms", () => {
  const settings = (s: Setup, onSave = vi.fn().mockResolvedValue(null)) => {
    render(<Settings org={s.org} numbering={null} logoUrl={null} onSave={onSave} onUploadLogo={vi.fn()} onRemoveLogo={vi.fn()} onSetNext={vi.fn()} />);
    return onSave;
  };

  test("shown with one-off invoices, 14 when not set; saved with the profile", async () => {
    const onSave = settings(setup());
    expect(screen.getByLabelText(/days to pay a one-off invoice/i)).toHaveProperty("value", "14");
    type(/days to pay a one-off invoice/i, "30");
    click("Save settings");
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ defaultTermsDays: 30, name: "Wari Electrical" });
  });

  test("more than 90 days is refused", () => {
    const onSave = settings(setup());
    type(/days to pay a one-off invoice/i, "91");
    click("Save settings");
    expect(screen.getByText("Choose from 0 to 90 days.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a Rentals-only org neither sees nor saves it", async () => {
    const onSave = settings(setup({ features: undefined }));
    expect(screen.queryByLabelText(/days to pay a one-off invoice/i)).toBeNull();
    click("Save settings");
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("defaultTermsDays");
  });
});

describe("a customer's details for their accounts", () => {
  test("with one-off invoices the form asks for them and saves the whole customer", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    const onDone = vi.fn();
    render(<TenantForm id="c2" setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={onDone} />);
    expect(screen.getByLabelText(/copy invoices to/i)).toHaveProperty("value", "boss@mine.example");
    expect(screen.getByLabelText(/order number/i)).toHaveProperty("checked", true);
    type(/copy invoices to/i, "boss@mine.example, files@mine.example");
    type(/their tin/i, "500099");
    click("Save");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("c2", {
      name: "Mine Services", email: "ap@mine.example", phone: "", ccEmails: ["boss@mine.example", "files@mine.example"],
      address: "", tin: "500099", gstNumber: "", termsDays: 30, poRequired: true, notes: "",
    });
  });

  test("a copy-to that is the main address is refused", () => {
    const onSave = vi.fn();
    render(<TenantForm id="c1" setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={vi.fn()} />);
    type(/copy invoices to/i, "ACCOUNTS@kila.example");
    click("Save");
    expect(screen.getByText("That address already gets the invoice.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a Rentals-only org sees the tenant form as before, and saves only name, email and phone", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<TenantForm id="c2" setup={setup({ features: undefined })} onSave={onSave} onDelete={vi.fn()} onDone={vi.fn()} />);
    expect(screen.queryByLabelText(/copy invoices to/i)).toBeNull();
    expect(screen.getByLabelText(/tenant's name/i)).toBeTruthy();
    click("Save");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("c2", { name: "Mine Services", email: "ap@mine.example", phone: "" }));
  });
});
