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
import type { Setup, SetupStore } from "./setup.js";

const setup: Setup = {
  org: {
    name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
    bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto",
  },
  properties: [], tenants: [{ id: "t1", name: "Kila Trading", email: "a@kila.example", phone: "" }], tenancies: [],
};
const fakeStore = (): SetupStore => ({
  load: vi.fn().mockResolvedValue(setup),
  saveProperty: vi.fn(), deleteProperty: vi.fn(), saveTenant: vi.fn(), deleteTenant: vi.fn(),
  createTenancy: vi.fn(), updateTenancy: vi.fn(), deleteTenancy: vi.fn(), saveProfile: vi.fn(),
  uploadLogo: vi.fn(), removeLogo: vi.fn(), logoUrl: vi.fn().mockResolvedValue(null),
  numbering: vi.fn().mockResolvedValue({ next: 1, started: false }), setNextNumber: vi.fn(),
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
    expect(await screen.findByLabelText(/number for your next invoice/i)).toBeTruthy();
  });

  test("an unknown address goes home", async () => {
    at("/nowhere");
    expect(await screen.findByRole("heading", { name: "Wari Holdings" })).toBeTruthy();
  });
});
