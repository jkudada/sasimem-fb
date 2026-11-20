/** G2q-a (docs/test-lists/general-g2q.md): the quote screens, the menu and Settings. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { DEFAULT_QUOTE_TERMS, type Item, type QuoteDraft, type Toea } from "@sasimem/core";
import { describe, expect, test, vi } from "vitest";
import type { Quotes as List, Outcome, QuoteDetail, Setup, WithId } from "../setup.js";
import { Home } from "./Home.js";
import { Quote } from "./Quote.js";
import { QuoteEditor } from "./QuoteEditor.js";
import { Quotes } from "./Quotes.js";
import { Settings } from "./Settings.js";

const type = (label: RegExp | string, value: string, within_: HTMLElement = document.body) =>
  fireEvent.input(within(within_).getByLabelText(label), { target: { value } });
const choose = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const line = (n: number) => screen.getByRole("group", { name: `Line ${n}` });

const ON = { rentals: true, repeating: true, oneOff: true, quotes: true };
const labour: WithId<Item> = { id: "i1", name: "Labour", description: "Electrician", unit: "hour", unitPriceToea: 8_000 as Toea, taxCode: "standard" };

const setup = (over: { features?: object; quoteValidDays?: number; quoteTerms?: string } = {}): Setup => ({
  org: {
    name: "Wari Electrical", address: "Boroko", email: "mary@wari.example", gstRegistered: true, gstNumber: "500012345",
    bankName: "BSP", bankAccount: "1000 2345", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto",
    features: over.features ?? ON,
    ...(over.quoteValidDays === undefined ? {} : { quoteValidDays: over.quoteValidDays }),
    ...(over.quoteTerms === undefined ? {} : { quoteTerms: over.quoteTerms }),
  },
  properties: [],
  tenants: [{ id: "c1", name: "Kila Trading", email: "accounts@kila.example", phone: "", ccEmails: ["boss@kila.example"] } as WithId<{ name: string; email: string; phone: string }>],
  tenancies: [],
  templates: [],
  items: [labour],
});

describe("the menu shows Quotes only with quotes on", () => {
  const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));

  test("with quotes: Quotes first", () => {
    render(<Home setup={setup()} onSignOut={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Quotes" }).getAttribute("href")).toBe("/quotes");
    expect(hrefs().indexOf("/quotes")).toBeLessThan(hrefs().indexOf("/one-off"));
  });

  test("one-off invoices without quotes: no Quotes", () => {
    render(<Home setup={setup({ features: { rentals: true, repeating: true, oneOff: true } })} onSignOut={vi.fn()} />);
    expect(hrefs()).not.toContain("/quotes");
  });
});

describe("the quote editor", () => {
  const editor = (over: { draft?: QuoteDraft; id?: string | null; setup?: Setup; send?: () => Promise<Outcome> } = {}) => {
    const onSave = vi.fn(async (_id: string | null, _draft: QuoteDraft): Promise<{ id: string }> => ({ id: "q1" }));
    const onSend = vi.fn(over.send ?? (async (_id: string): Promise<Outcome> => ({ ok: true, message: "Sent QUO-0001 to Kila Trading." })));
    const onDone = vi.fn();
    render(<QuoteEditor id={over.id ?? null} draft={over.draft ?? null} setup={over.setup ?? setup()} onSave={onSave} onDelete={vi.fn()} onSend={onSend} onDone={onDone} />);
    return { onSave, onSend, onDone };
  };

  test("a customer, a line from the price list, totals with GST; Send quote saves, sends and says so", async () => {
    const { onSave, onSend } = editor();
    choose("Customer", "c1");
    expect(screen.getByText(/Emailed to accounts@kila\.example, copy to boss@kila\.example\./)).toBeTruthy();
    choose("Add from your price list", "i1");
    type("Quantity", "2", line(1));
    expect(screen.getByLabelText("Totals").textContent).toContain("K176.00");
    type(/note on the quote/i, "Parts held 30 days");
    click("Send quote");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Sent QUO-0001 to Kila Trading."));
    expect(onSave.mock.calls[0]).toEqual([null, {
      customerId: "c1", notes: "Parts held 30 days", validDays: null, revises: null,
      lines: [{ description: "Labour", detail: "Electrician", quantityMilli: 2000, unit: "hour", unitPriceToea: 8_000, taxCode: "standard" }],
    }]);
    expect(onSend).toHaveBeenCalledWith("q1");
    expect(screen.getByRole("link", { name: "Write another quote" }).getAttribute("href")).toBe("/quotes/new");
  });

  test("valid for: the org's days by default; the quote's own when typed; outside 1-365 refused", async () => {
    const { onSave } = editor({ setup: setup({ quoteValidDays: 45 }) });
    expect(screen.getByText("Leave blank for your usual 45 days.")).toBeTruthy();
    type("Price each", "K25", line(1));
    type(/days it is valid/i, "400");
    click("Save draft");
    expect(screen.getByText("Choose from 1 to 365 days.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    type(/days it is valid/i, "14");
    click("Save draft");
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({ validDays: 14 });
  });

  test("Save draft keeps an unfinished quote; Send quote names what is missing and sends nothing", async () => {
    const { onSave, onSend, onDone } = editor();
    type("What for", "Half done", line(1));
    type("Price each", "K25", line(1));
    click("Send quote");
    expect(screen.getByText("Choose who this quote is for.")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
    click("Save draft");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalled();
  });

  test("a saved draft opens as it was; a refused send keeps it and shows why", async () => {
    const draft: QuoteDraft = { customerId: "c1", lines: [{ description: "Rewire", detail: "", quantityMilli: 1000, unit: "", unitPriceToea: 50_000 as Toea, taxCode: "standard" }], notes: "", validDays: 7, revises: null };
    editor({ id: "q9", draft, send: async () => ({ ok: false, message: "Quotes are not switched on for your account." }) });
    expect(screen.getByRole("heading", { name: "Edit draft quote" })).toBeTruthy();
    expect((screen.getByLabelText(/days it is valid/i) as HTMLInputElement).value).toBe("7");
    click("Send quote");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Quotes are not switched on for your account."));
    expect(screen.getByRole("button", { name: "Delete this draft" })).toBeTruthy();
  });
});

describe("the list of quotes", () => {
  test("drafts, then sent quotes with number, customer, total, valid until and status", () => {
    const list: List = {
      drafts: [{ id: "d1", customerId: "c1", lines: [{ description: "Labour", detail: "", quantityMilli: 1000, unit: "hour", unitPriceToea: 8_000 as Toea, taxCode: "standard" }], notes: "", validDays: null, revises: null }],
      sent: [
        { id: "q2", label: "QUO-0002", customerName: "Mine Services", issueDate: "2026-11-19" as never, validUntil: "2026-12-19" as never, totalToea: 28_050 as Toea, status: "sent" },
        { id: "q1", label: "QUO-0001", customerName: "Kila Trading", issueDate: "2026-11-01" as never, validUntil: "2026-12-01" as never, totalToea: 11_000 as Toea, status: "viewed" },
        ...(["accepted", "declined", "expired"] as const).map((status, i) => ({ id: `o${i}`, label: `QUO-000${i + 3}`, customerName: "Other", issueDate: "2026-10-01" as never, validUntil: "2026-10-31" as never, totalToea: 5_000 as Toea, status })),
      ],
    };
    render(<Quotes list={list} setup={setup()} />);
    expect(screen.getByRole("link", { name: "Kila Trading" }).getAttribute("href")).toBe("/quotes/d1");
    expect(screen.getByText(/Draft · 1 line K88\.00/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "QUO-0002 · Mine Services" }).getAttribute("href")).toBe("/quotes/sent/q2");
    expect(screen.getByText("K280.50 · valid until 19 December 2026 · Sent")).toBeTruthy();
    expect(screen.getByText("K110.00 · valid until 1 December 2026 · Viewed")).toBeTruthy();
    for (const s of ["Accepted", "Declined", "Expired"]) expect(screen.getByText(`K50.00 · valid until 31 October 2026 · ${s}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "New quote" }).getAttribute("href")).toBe("/quotes/new");
  });
});

describe("a sent quote (G2q-b)", () => {
  const NOW = new Date("2026-11-20T02:00:00Z");
  const TZ = "Pacific/Port_Moresby";
  const base: QuoteDetail = {
    id: "q1", label: "QUO-0001", customerName: "Kila Trading", issueDate: "2026-11-19" as never, validUntil: "2026-12-19" as never,
    totalToea: 28_050 as Toea, status: "sent", viewedAt: null, acceptance: null, decline: null, invoiceIds: [],
  };
  const show = (quote: Partial<QuoteDetail> = {}, over: { mark?: () => Promise<Outcome>; undo?: () => Promise<Outcome> } = {}) => {
    const onMark = vi.fn(over.mark ?? (async (): Promise<Outcome> => ({ ok: true, message: "Recorded: QUO-0001 accepted by Peter Kila." })));
    const onUndo = vi.fn(over.undo ?? (async (): Promise<Outcome> => ({ ok: true, message: "QUO-0001 is open again." })));
    const onChanged = vi.fn();
    render(<Quote quote={{ ...base, ...quote }} timezone={TZ} now={NOW} onMark={onMark} onUndo={onUndo} onChanged={onChanged} />);
    return { onMark, onUndo, onChanged };
  };

  test("viewed: the status, when it was first opened; Record an answer, no Undo", () => {
    show({ status: "viewed", viewedAt: new Date("2026-11-19T22:30:00Z") });
    expect(screen.getByRole("heading", { name: "QUO-0001" })).toBeTruthy();
    expect(screen.getByText("Kila Trading · K280.50 · valid until 19 December 2026")).toBeTruthy();
    expect(screen.getByText(/first opened/).textContent).toBe("Viewed · first opened at 8:30 am on 20 November 2026");
    expect(screen.getByRole("button", { name: "Record an answer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo the acceptance" })).toBeNull();
  });

  test("accepted on the link: who, when and the PO; Undo, which reloads it", async () => {
    const { onUndo, onChanged } = show({ status: "accepted", acceptance: { by: "customer", name: "Peter Kila", poNumber: "PO-4471", at: new Date("2026-11-20T02:00:00Z") } });
    expect(screen.getByText(/Accepted by/).textContent).toBe("Accepted by Peter Kila at 12:00 pm on 20 November 2026, on the quote's link. Order number PO-4471.");
    expect(screen.queryByRole("button", { name: "Record an answer" })).toBeNull();
    click("Undo the acceptance");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("QUO-0001 is open again."));
    expect(onUndo).toHaveBeenCalledWith("q1");
    expect(onChanged).toHaveBeenCalled();
  });

  test("declined, recorded by the owner, with the reason; nothing to do", () => {
    show({ status: "declined", decline: { by: "owner", reason: "Went elsewhere", at: new Date("2026-11-20T02:00:00Z") } });
    expect(screen.getByText(/Declined at/).textContent).toBe("Declined at 12:00 pm on 20 November 2026, recorded by you. Reason: Went elsewhere");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  test("invoiced or expired: no Undo, no answer", () => {
    show({ status: "accepted", acceptance: { by: "owner", name: "Peter Kila", poNumber: "", at: NOW }, invoiceIds: ["inv1"] });
    expect(screen.queryAllByRole("button")).toEqual([]);
    cleanup();
    show({ status: "sent", validUntil: "2026-11-19" as never });
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  test("Record an answer: accepted with who and the order number, or declined with a reason; a refusal shows", async () => {
    const { onMark, onChanged } = show();
    click("Record an answer");
    type("Who accepted", "Peter Kila");
    type(/order number/i, "4471");
    click("Record");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Recorded: QUO-0001 accepted by Peter Kila."));
    expect(onMark).toHaveBeenCalledWith("q1", { answer: "accept", name: "Peter Kila", poNumber: "4471", reason: "" });
    expect(onChanged).toHaveBeenCalled();
    cleanup();

    const refused = show({}, { mark: async () => ({ ok: false, message: "QUO-0001 was already accepted." }) });
    click("Record an answer");
    fireEvent.change(screen.getByLabelText("Declined"));
    type(/their reason/i, "Too dear");
    click("Record");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("QUO-0001 was already accepted."));
    expect(refused.onMark).toHaveBeenCalledWith("q1", { answer: "decline", name: "", poNumber: "", reason: "Too dear" });
    expect(refused.onChanged).not.toHaveBeenCalled();
  });
});

describe("Settings: quotes", () => {
  const settings = (s: Setup, onSave = vi.fn().mockResolvedValue(null)) => {
    render(<Settings org={s.org} numbering={null} logoUrl={null} onSave={onSave} onUploadLogo={vi.fn()} onRemoveLogo={vi.fn()} onSetNext={vi.fn()} />);
    return onSave;
  };

  test("days valid (30) and the terms (the default filled in), saved with the profile", async () => {
    const onSave = settings(setup());
    expect((screen.getByLabelText(/days a quote is valid/i) as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText(/quote terms/i) as HTMLTextAreaElement).value).toBe(DEFAULT_QUOTE_TERMS);
    type(/days a quote is valid/i, "14");
    type(/quote terms/i, "  Cash on completion.  ");
    click("Save settings");
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ quoteValidDays: 14, quoteTerms: "Cash on completion." });
  });

  test("the org's own settings show; bad ones are refused", () => {
    const onSave = settings(setup({ quoteValidDays: 60, quoteTerms: "" }));
    expect((screen.getByLabelText(/days a quote is valid/i) as HTMLInputElement).value).toBe("60");
    expect((screen.getByLabelText(/quote terms/i) as HTMLTextAreaElement).value).toBe("");
    type(/days a quote is valid/i, "0");
    type(/quote terms/i, "x".repeat(2001));
    click("Save settings");
    expect(screen.getByText("Choose from 1 to 365 days.")).toBeTruthy();
    expect(screen.getByText("Keep the terms to 2,000 characters or fewer.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("without quotes: neither shown nor saved", async () => {
    const onSave = settings(setup({ features: { rentals: true, repeating: true, oneOff: true } }));
    expect(screen.queryByLabelText(/quote terms/i)).toBeNull();
    click("Save settings");
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("quoteTerms");
    cleanup();
  });
});
