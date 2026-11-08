import { signal } from "@preact/signals";
import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type Actions, App } from "./app.js";
import type { Session } from "./route.js";
// The screens are lazy in the app; loading them here keeps module transforms out of test timings.
import "./screens/OrgStep.js";
import "./screens/SignIn.js";
import "./screens/TenancyStep.js";
import "./SignedIn.js";
import "./screens/Home.js";
import "./screens/Tenants.js";
import "./screens/Settings.js";
import "./screens/Templates.js";
import "./screens/TemplateForm.js";
import "./screens/MonthCard.js";
import "./screens/Review.js";
import type { Setup, SetupStore } from "./setup.js";

const setup: Setup = {
  org: {
    name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
    bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto",
  },
  properties: [], tenants: [{ id: "t1", name: "Kila Trading", email: "a@kila.example", phone: "" }], tenancies: [], templates: [],
};
const fakeStore = (): SetupStore => ({
  load: vi.fn(async () => ({ ...setup })), // a fresh object each time, as a real read gives
  saveProperty: vi.fn(), deleteProperty: vi.fn(), saveTenant: vi.fn(), deleteTenant: vi.fn(),
  createTenancy: vi.fn(), updateTenancy: vi.fn(), deleteTenancy: vi.fn(), saveProfile: vi.fn(),
  uploadLogo: vi.fn(), removeLogo: vi.fn(), saveLogoDesign: vi.fn(), logoUrl: vi.fn().mockResolvedValue(null),
  saveTemplate: vi.fn(), deleteTemplate: vi.fn(), setDefaultTemplate: vi.fn(), previewTemplate: vi.fn(),
  numbering: vi.fn().mockResolvedValue({ next: 1, started: false }), setNextNumber: vi.fn(),
  month: vi.fn().mockResolvedValue(null),
  draftNow: vi.fn(), setRent: vi.fn(), exclude: vi.fn(), include: vi.fn(), rebuildRun: vi.fn(), approveRun: vi.fn(),
  months: vi.fn().mockResolvedValue([]), owed: vi.fn().mockResolvedValue([]),
  markPaid: vi.fn(), markUnpaid: vi.fn(), pauseReminders: vi.fn(), voidInvoice: vi.fn(), resendInvoice: vi.fn(), openPdf: vi.fn(), exportCsv: vi.fn(),
});

const noActions = (): Actions => ({
  signIn: vi.fn().mockResolvedValue(null),
  signUp: vi.fn().mockResolvedValue(null),
  reset: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  createOrg: vi.fn().mockResolvedValue(null),
  saveFirstTenancy: vi.fn().mockResolvedValue(null),
  setupStore: vi.fn(async () => fakeStore()),
});
const type = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe("the app shell", () => {
  test("a signed-out visitor sees sign-in", async () => {
    render(<App session={signal<Session>({ status: "signedOut" })} actions={noActions()} today={() => "2026-09-20"} />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  test("once a new landlord's details are saved, they go straight on to their first tenant", async () => {
    const session = signal<Session>({ status: "signedIn", email: "mary@wari.example", orgId: null });
    const actions = noActions();
    actions.createOrg = vi.fn(async () => {
      session.value = { status: "signedIn", email: "mary@wari.example", orgId: "org1" };
      return null;
    });
    render(<App session={session} actions={actions} today={() => "2026-09-20"} />);
    expect(await screen.findByRole("heading", { name: "Your details" })).toBeTruthy();
    type(/name on your invoices/i, "Wari Holdings");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your first tenant" })).toBeTruthy();
  });

  test("after the first tenant is saved in onboarding, the landlord lands on home", async () => {
    const session = signal<Session>({ status: "signedIn", email: "mary@wari.example", orgId: null });
    const actions = noActions();
    actions.createOrg = vi.fn(async () => {
      session.value = { status: "signedIn", email: "mary@wari.example", orgId: "org1" };
      return null;
    });
    render(<App session={session} actions={actions} today={() => "2026-09-20"} />);
    await screen.findByRole("heading", { name: "Your details" });
    type(/name on your invoices/i, "Wari Holdings");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Your first tenant" });
    type(/property address/i, "Lot 9");
    type(/tenant's name/i, "Kila Trading");
    type(/tenant's email/i, "a@kila.example");
    type(/monthly rent/i, "1200");
    type(/payment reference/i, "KILA");
    fireEvent.click(screen.getByRole("button", { name: "Save and finish" }));
    expect(await screen.findByRole("heading", { name: "Wari Holdings" })).toBeTruthy();
    expect(actions.saveFirstTenancy).toHaveBeenCalledTimes(1);
  });
});

describe("signed-in routes", () => {
  afterEach(() => history.replaceState(null, "", "/"));
  const at = (path: string) => {
    history.replaceState(null, "", path);
    render(<App session={signal<Session>({ status: "signedIn", email: "m@w.example", orgId: "org1" })} actions={noActions()} today={() => "2026-09-20"} />);
  };

  test("each setup screen has its own address", async () => {
    at("/tenants");
    expect(await screen.findByRole("heading", { name: "Tenants" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Kila Trading/ })).toBeTruthy();
  });

  test("settings loads where invoice numbering starts", async () => {
    at("/settings");
    expect(((await screen.findByLabelText(/number for your next invoice/i)) as HTMLInputElement).value).toBe("1");
  });

  test("a save that reloads the data keeps the screen, and its message, in place", async () => {
    const actions = noActions();
    const store = fakeStore();
    store.saveProfile = vi.fn().mockResolvedValue(null);
    actions.setupStore = vi.fn(async () => store);
    history.replaceState(null, "", "/settings");
    render(<App session={signal<Session>({ status: "signedIn", email: "m@w.example", orgId: "org1" })} actions={actions} today={() => "2026-09-20"} />);
    await screen.findByLabelText(/number for your next invoice/i);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await vi.waitFor(() => expect(store.load).toHaveBeenCalledTimes(2), { interval: 5 });
    expect((await screen.findByRole("status")).textContent).toMatch(/^Saved/);
  });

  test("a screen that saves in place shows the reloaded data: a new logo appears", async () => {
    const actions = noActions();
    const store = fakeStore();
    store.load = vi.fn().mockResolvedValueOnce(setup).mockResolvedValue({ ...setup, org: { ...setup.org, logoPath: "logos/org1/1.png" } });
    store.uploadLogo = vi.fn().mockResolvedValue(null);
    store.logoUrl = vi.fn().mockResolvedValue("https://logo.example/1.png");
    actions.setupStore = vi.fn(async () => store);
    history.replaceState(null, "", "/settings");
    render(<App session={signal<Session>({ status: "signedIn", email: "m@w.example", orgId: "org1" })} actions={actions} today={() => "2026-09-20"} />);
    fireEvent.change(await screen.findByLabelText(/logo/i), { target: { files: [new File(["x"], "logo.png", { type: "image/png" })] } });
    expect((await screen.findByRole("img", { name: "Your logo" })).getAttribute("src")).toBe("https://logo.example/1.png");
  });

  test("home offers this month's one action, and each month has its own review address", async () => {
    const actions = noActions();
    const store = fakeStore();
    store.month = vi.fn(async (period: string) => (period === "2026-09" ? {
      period, status: "awaitingApproval", sendAt: new Date("2026-08-31T22:00:00Z"), totalToea: 120_000, invoiceCount: 1,
      invoices: [{ id: "k1_2026-09", tenantName: "Kila Trading", unitLabel: "Shop 1", status: "draft", rentToea: 120_000, totalToea: 120_000, number: null }],
    } : null)) as never;
    actions.setupStore = vi.fn(async () => store);
    render(<App session={signal<Session>({ status: "signedIn", email: "m@w.example", orgId: "org1" })} actions={actions} today={() => "2026-09-20"} />);
    const review = await screen.findByRole("link", { name: "Review 1 invoice" });
    expect(review.getAttribute("href")).toBe("/month/2026-09");
    fireEvent.click(review);
    expect(await screen.findByRole("heading", { name: "September 2026 invoices" })).toBeTruthy();
  });

  test("an unknown address goes home", async () => {
    at("/nowhere");
    expect(await screen.findByRole("heading", { name: "Wari Holdings" })).toBeTruthy();
  });
});
