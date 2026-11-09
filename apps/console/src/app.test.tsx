import { signal } from "@preact/signals";
import { type CalendarDate, defaultPlan, newTrialSubscription } from "@sasimem/core";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import { type Actions, App } from "./app.js";
import type { ConsoleData } from "./data.js";
import type { ConsoleSession } from "./session.js";
import type { SubscriberDetail, SubscriberInput } from "./types.js";
// Lazy in the app; loaded here so module transforms stay out of test timings.
import "./screens/SignIn.js";
import "./screens/Enrol.js";
import "./screens/Subscribers.js";
import "./screens/Subscriber.js";
import "./screens/Health.js";

const now = () => new Date("2027-03-01T00:00:00Z");
const sub = newTrialSubscription({ plan: defaultPlan("standard"), today: "2027-02-01" as CalendarDate, referenceNumber: 7 });
const wari: SubscriberInput = {
  org: { id: "o1", name: "Wari Holdings", email: "mary@wari.example", createdAt: new Date("2026-06-01T00:00:00Z") },
  sub: { ...sub, activeTenancyCount: 4 },
  runs: [{ period: "2027-02", status: "sent", approvedAt: new Date("2027-01-29T00:00:00Z"), invoiceCount: 4, totalToea: 480_000 }],
  emails: [],
};
const kila: SubscriberInput = {
  org: { id: "o2", name: "Kila Trading", email: "accounts@kila.example", createdAt: new Date("2026-06-01T00:00:00Z") },
  sub: { ...sub, paymentReference: "SUB-0008" },
  runs: [{ period: "2027-03", status: "held", approvedAt: null, invoiceCount: 2, totalToea: 200_000 }],
  emails: [{ id: "e1", kind: "tenantInvoice", to: "bad@x.example", subject: "Invoice", status: "failed", sentAt: new Date("2027-02-20T00:00:00Z"), error: "Invalid `to` field." }],
};
const detail: SubscriberDetail = {
  org: { ...wari.org, address: "Boroko", gstRegistered: false, gstNumber: "", timezone: "Pacific/Port_Moresby" },
  sub: wari.sub, payments: [{ id: "p1", amountToea: 40_000, receivedOn: "2027-02-02" as CalendarDate, bankReference: "BSP 123" }],
  notes: [{ id: "n1", text: "Called about the renewal", by: "op@sasimem.example", at: new Date("2027-02-03T00:00:00Z") }],
  events: [{ id: "v1", kind: "recordPayment", actor: "op-uid", at: new Date("2027-02-02T00:00:00Z") }],
  runs: wari.runs, emails: [{ id: "e2", kind: "dispatch", to: "mary@wari.example", subject: "Sent", status: "sent", sentAt: new Date("2027-02-01T00:00:00Z"), error: null }],
  invoices: [{ id: "k1_2027-02", number: "INV-0012", tenantName: "Peter Kila", status: "paid", totalToea: 120_000 }],
};
const data = (): ConsoleData => ({
  subscribers: vi.fn(async () => [wari, kila]),
  subscriber: vi.fn(async (id: string) => (id === "o1" ? detail : null)),
  tick: vi.fn(async () => ({ lastSuccessAt: new Date("2027-02-28T23:30:00Z"), tally: {} })),
});
const actions = (o: Partial<Actions> = {}): Actions => {
  const d = data();
  return {
    signIn: vi.fn().mockResolvedValue({ kind: "in" }), verifyCode: vi.fn().mockResolvedValue(null),
    startEnrolment: vi.fn().mockResolvedValue({ key: "JBSWY3DPEHPK3PXP", url: "otpauth://totp/Sasimem%20console:op?secret=JBSWY3DPEHPK3PXP" }),
    finishEnrolment: vi.fn().mockResolvedValue(null), signOut: vi.fn().mockResolvedValue(undefined),
    data: vi.fn(async () => d), ...o,
  };
};
const show = (s: ConsoleSession, a = actions()) => {
  render(<App session={signal(s)} actions={a} now={now} />);
  return a;
};
const type = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe("signing in (PLAN-SUBSCRIBERS D10)", () => {
  test("email and password, then the authenticator code when Firebase asks for it", async () => {
    const a = show({ status: "signedOut" }, actions({ signIn: vi.fn().mockResolvedValue({ kind: "code" }) }));
    await screen.findByLabelText(/email/i); // the screen is lazy
    type(/email/i, "op@sasimem.example");
    type(/password/i, "secret-123");
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await screen.findByLabelText(/code/i);
    type(/code/i, "123456");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(a.verifyCode).toHaveBeenCalledWith("123456"));
  });

  test("a wrong code says so, in plain words", async () => {
    show({ status: "signedOut" }, actions({ signIn: vi.fn().mockResolvedValue({ kind: "code" }), verifyCode: vi.fn().mockResolvedValue("That code is not right.") }));
    await screen.findByLabelText(/email/i); // the screen is lazy
    type(/email/i, "op@sasimem.example");
    type(/password/i, "x");
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await screen.findByLabelText(/code/i);
    type(/code/i, "000000");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That code is not right.");
  });

  test("a refused password shows the problem and asks for no code", async () => {
    show({ status: "signedOut" }, actions({ signIn: vi.fn().mockResolvedValue({ kind: "problem", message: "That email and password do not match." }) }));
    await screen.findByLabelText(/email/i); // the screen is lazy
    type(/email/i, "op@sasimem.example");
    type(/password/i, "x");
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That email and password do not match.");
    expect(screen.queryByLabelText(/code/i)).toBeNull();
  });
});

describe("before any data is shown", () => {
  test("an operator with no code set up is taken to set one up, and no data is read", async () => {
    const a = show({ status: "needsEnrolment", email: "op@sasimem.example" });
    fireEvent.click(await screen.findByRole("button", { name: "Set up the code" }));
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open in your authenticator app/i }).getAttribute("href")).toMatch(/^otpauth:\/\/totp\//);
    type(/code/i, "123456");
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await vi.waitFor(() => expect(a.finishEnrolment).toHaveBeenCalledWith("123456"));
    expect(a.data).not.toHaveBeenCalled();
  });

  test("setting up the code shows the problem when the project has no TOTP yet", async () => {
    show({ status: "needsEnrolment", email: "op@sasimem.example" }, actions({ startEnrolment: vi.fn().mockResolvedValue({ problem: "Two-step codes are not turned on for this project yet." }) }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up the code" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Two-step codes are not turned on for this project yet.");
  });

  test("signed in without the code, an operator is asked to sign in again with it", async () => {
    const a = show({ status: "needsSecondFactor", email: "op@sasimem.example" });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(a.signOut).toHaveBeenCalled();
    expect(a.data).not.toHaveBeenCalled();
  });

  test("someone without the operator role is told so and sees nothing", async () => {
    const a = show({ status: "notOperator", email: "mary@wari.example" });
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/not an operator/i);
    expect(a.data).not.toHaveBeenCalled();
  });
});

describe("Subscribers (PLAN-SUBSCRIBERS §7)", () => {
  test("one row per org with plan, status, used of the limit, the date that matters and the reference", async () => {
    show({ status: "ready", email: "op@sasimem.example" });
    const row = (await screen.findByRole("link", { name: "Wari Holdings" })).closest("tr") as HTMLElement;
    const text = row.textContent ?? "";
    for (const s of ["Standard", "Trial", "4 of 10", "Trial ends 1 April 2027", "SUB-0007"]) expect(text).toContain(s);
  });

  test("a filter narrows the list: Needs a look shows only the org with a held run and failed email", async () => {
    show({ status: "ready", email: "op@sasimem.example" });
    await screen.findByRole("link", { name: "Wari Holdings" });
    fireEvent.click(screen.getByRole("button", { name: /^Needs a look/ }));
    expect(screen.queryByRole("link", { name: "Wari Holdings" })).toBeNull();
    const row = screen.getByRole("link", { name: "Kila Trading" }).closest("tr") as HTMLElement;
    expect(row.textContent).toContain("1 held run, 1 email failed");
  });
});

describe("one subscriber, read-only (D11)", () => {
  test("org details, subscription, payments, notes, audit trail, runs, latest invoices and emails", async () => {
    window.history.pushState({}, "", "/s/o1");
    show({ status: "ready", email: "op@sasimem.example" });
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Wari Holdings");
    const text = document.body.textContent ?? "";
    for (const s of ["SUB-0007", "K400.00", "BSP 123", "Called about the renewal", "recordPayment", "INV-0012", "Peter Kila", "K1,200.00", "dispatch"]) {
      expect(text).toContain(s);
    }
    window.history.pushState({}, "", "/");
  });

  test("offers no button that changes anything: only navigation and sign out", async () => {
    window.history.pushState({}, "", "/s/o1");
    show({ status: "ready", email: "op@sasimem.example" });
    await screen.findByRole("heading", { level: 1, name: "Wari Holdings" });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Sign out"]);
    window.history.pushState({}, "", "/");
  });

  test("an unknown org says so", async () => {
    window.history.pushState({}, "", "/s/nope");
    show({ status: "ready", email: "op@sasimem.example" });
    expect(await screen.findByText(/no organisation with that id/i)).toBeTruthy();
    window.history.pushState({}, "", "/");
  });
});

describe("Health", () => {
  test("the last tick, held runs and failed emails across every org", async () => {
    window.history.pushState({}, "", "/health");
    show({ status: "ready", email: "op@sasimem.example" });
    const tick = await screen.findByRole("region", { name: "The hourly tick" });
    expect(tick.textContent).toMatch(/last succeeded/i);
    expect(within(screen.getByRole("region", { name: "Held runs" })).getByRole("link", { name: "Kila Trading" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Failed emails, last 30 days" }).textContent).toContain("bad@x.example");
    window.history.pushState({}, "", "/");
  });
});
