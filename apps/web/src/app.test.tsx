import { signal } from "@preact/signals";
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import { type Actions, App } from "./app.js";
import type { Session } from "./route.js";
// The screens are lazy in the app; loading them here keeps module transforms out of test timings.
import "./screens/OrgStep.js";
import "./screens/SignIn.js";
import "./screens/TenancyStep.js";

const noActions = (): Actions => ({
  signIn: vi.fn().mockResolvedValue(null),
  signUp: vi.fn().mockResolvedValue(null),
  reset: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  createOrg: vi.fn().mockResolvedValue(null),
  saveFirstTenancy: vi.fn().mockResolvedValue(null),
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

  test("a tenant added from home is saved, and the landlord is back home", async () => {
    const actions = noActions();
    render(<App session={signal<Session>({ status: "signedIn", email: "m@w.example", orgId: "org1" })} actions={actions} today={() => "2026-09-20"} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a tenant" }));
    await screen.findByRole("heading", { name: "Your first tenant" });
    type(/property address/i, "Lot 9");
    type(/tenant's name/i, "Kila Trading");
    type(/tenant's email/i, "a@kila.example");
    type(/monthly rent/i, "1200");
    type(/payment reference/i, "KILA");
    fireEvent.click(screen.getByRole("button", { name: "Save and finish" }));
    expect(await screen.findByRole("heading", { name: "You're set up" })).toBeTruthy();
    expect(actions.saveFirstTenancy).toHaveBeenCalledTimes(1);
  });
});
