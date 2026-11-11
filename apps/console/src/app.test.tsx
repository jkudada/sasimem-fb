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
import { SubscriberActions } from "./screens/SubscriberActions.js";
import "./screens/Invites.js";

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
const trialSub = { ...sub, activeTenancyCount: 4 };
const detail: SubscriberDetail = {
  org: { ...wari.org, address: "Boroko", gstRegistered: false, gstNumber: "", timezone: "Pacific/Port_Moresby" },
  sub: wari.sub, payments: [{ id: "p1", amountToea: 40_000, receivedOn: "2027-02-02" as CalendarDate, bankReference: "BSP 123" }],
  notes: [{ id: "n1", text: "Called about the renewal", by: "op@sasimem.example", at: new Date("2027-02-03T00:00:00Z") }],
  events: [{
    id: "v1", kind: "recordPayment", actor: "op-uid", actorEmail: "op@sasimem.example", at: new Date("2027-02-02T00:00:00Z"),
    changes: [{ field: "paidThrough", before: null, after: "2028-03-31" }],
  }],
  runs: wari.runs, emails: [{ id: "e2", kind: "dispatch", to: "mary@wari.example", subject: "Sent", status: "sent", sentAt: new Date("2027-02-01T00:00:00Z"), error: null }],
  invoices: [{ id: "k1_2027-02", number: "INV-0012", tenantName: "Peter Kila", status: "paid", totalToea: 120_000 }],
};
const data = (): ConsoleData => ({
  subscribers: vi.fn(async () => [wari, kila]),
  subscriber: vi.fn(async (id: string) => (id === "o1" ? detail : null)),
  tick: vi.fn(async () => ({ lastSuccessAt: new Date("2027-02-28T23:30:00Z"), tally: {} })),
  subscriptionTick: vi.fn(async () => ({ lastSuccessAt: new Date("2027-02-28T20:00:00Z"), tally: {} })),
  invites: vi.fn(async () => [
    { email: "ann@kila.example", planId: "plus" as const, trialDays: 30, expiresAt: new Date("2027-03-20T00:00:00Z"), invitedAt: new Date("2027-02-20T00:00:00Z"), used: false, sendCount: 1, lastError: null },
    { email: "mary@wari.example", planId: null, trialDays: null, expiresAt: null, invitedAt: new Date("2026-06-01T00:00:00Z"), used: true, sendCount: 0, lastError: null },
  ]),
});
const actions = (o: Partial<Actions> = {}): Actions => {
  const d = data();
  return {
    signIn: vi.fn().mockResolvedValue({ kind: "in" }), verifyCode: vi.fn().mockResolvedValue(null),
    startEnrolment: vi.fn().mockResolvedValue({ key: "JBSWY3DPEHPK3PXP", url: "otpauth://totp/Sasimem%20console:op?secret=JBSWY3DPEHPK3PXP" }),
    finishEnrolment: vi.fn().mockResolvedValue(null), signOut: vi.fn().mockResolvedValue(undefined),
    data: vi.fn(async () => d), operate: vi.fn().mockResolvedValue(null), invite: vi.fn().mockResolvedValue(null), ...o,
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

  test("the audit trail shows who changed what, before and after", async () => {
    window.history.pushState({}, "", "/s/o1");
    show({ status: "ready", email: "op@sasimem.example" });
    const trail = await screen.findByRole("region", { name: "Audit trail" });
    expect(trail.textContent).toContain("recordPayment by op@sasimem.example");
    expect(trail.textContent).toContain("paidThrough: - → 2028-03-31");
    window.history.pushState({}, "", "/");
  });

  test("the subscriber's own screens are not editable here: the only changes are the Actions forms (D11)", async () => {
    window.history.pushState({}, "", "/s/o1");
    show({ status: "ready", email: "op@sasimem.example" });
    await screen.findByRole("heading", { level: 1, name: "Wari Holdings" });
    for (const name of ["Organisation", "Subscription", "Payments", "Runs"]) {
      expect(within(screen.getByRole("region", { name })).queryAllByRole("button")).toEqual([]);
    }
    window.history.pushState({}, "", "/");
  });
});

describe("acting on a subscriber (PLAN-SUBSCRIBERS S3)", () => {
  // The forms alone: the whole page is rendered once, for the reload.
  const forms = (o: { operate?: Actions["operate"] } = {}) => {
    const operate = vi.fn(o.operate ?? (async () => null));
    const onDone = vi.fn();
    render(<SubscriberActions sub={trialSub} status="trial" operate={(action) => operate("o1", action)} onDone={onDone} now={now} />);
    return { operate, onDone };
  };
  const form = (name: string) => within(screen.getByRole("form", { name }));

  test("on the page, a change goes to this org and success reloads it", async () => {
    window.history.pushState({}, "", "/s/o1");
    const a = show({ status: "ready", email: "op@sasimem.example" });
    const d = await a.data();
    fireEvent.click(await screen.findByRole("button", { name: "Restrict" }));
    await vi.waitFor(() => expect(a.operate).toHaveBeenCalledWith("o1", { kind: "restrict" }));
    await vi.waitFor(() => expect(d.subscriber).toHaveBeenCalledTimes(2));
    window.history.pushState({}, "", "/");
  });

  test("a payment is typed in kina and sent in toea", async () => {
    const { operate } = forms();
    const pay = form("Record a payment");
    fireEvent.input(pay.getByLabelText(/amount/i), { target: { value: "1,000.50" } });
    fireEvent.input(pay.getByLabelText(/arrived on/i), { target: { value: "2027-02-27" } });
    fireEvent.input(pay.getByLabelText(/bank reference/i), { target: { value: "BSP 998877" } });
    fireEvent.click(pay.getByRole("button", { name: "Record payment" }));
    await vi.waitFor(() => expect(operate).toHaveBeenCalledWith("o1", { kind: "recordPayment", amountToea: 100_050, receivedOn: "2027-02-27", bankReference: "BSP 998877", months: 12 }));
  });

  test("an amount that is not one says so, and nothing is sent", async () => {
    const { operate } = forms();
    const pay = form("Record a payment");
    fireEvent.input(pay.getByLabelText(/amount/i), { target: { value: "four hundred" } });
    fireEvent.click(pay.getByRole("button", { name: "Record payment" }));
    expect((await pay.findByRole("alert")).textContent).toBe("Enter the amount in kina, like 400.00.");
    expect(operate).not.toHaveBeenCalled();
  });

  test("a refusal shows the server's words, in the form that was used, and does not reload", async () => {
    const { onDone } = forms({ operate: async () => "Extend a trial by 1 to 365 days." });
    const trial = form("Extend the trial");
    fireEvent.input(trial.getByLabelText(/days/i), { target: { value: "999" } });
    fireEvent.click(trial.getByRole("button", { name: "Extend trial" }));
    expect((await trial.findByRole("alert")).textContent).toBe("Extend a trial by 1 to 365 days.");
    expect(onDone).not.toHaveBeenCalled();
  });

  const each: [string, () => void, unknown][] = [
    ["change plan", () => {
      fireEvent.change(form("Change plan").getByLabelText("Plan"), { target: { value: "plus" } });
      fireEvent.click(form("Change plan").getByRole("button", { name: "Change plan" }));
    }, { kind: "changePlan", planId: "plus", interval: "annual" }],
    ["clear the limit (blank: the plan's)", () => fireEvent.click(screen.getByRole("button", { name: "Set limit" })), { kind: "setLimitOverride", limit: null }],
    ["restrict by hand", () => fireEvent.click(screen.getByRole("button", { name: "Restrict" })), { kind: "restrict" }],
    ["add a note", () => {
      fireEvent.input(screen.getByLabelText("Note"), { target: { value: "Rang Mary." } });
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    }, { kind: "addNote", text: "Rang Mary." }],
  ];
  for (const [name, use, action] of each) {
    test(`${name} sends its own action`, async () => {
      const { operate, onDone } = forms();
      use();
      await vi.waitFor(() => expect(operate).toHaveBeenCalledWith("o1", action));
      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    });
  }

  test("cancelling asks first, and can be backed out of", async () => {
    const { operate } = forms();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the subscription…" }));
    const confirm = form("Cancel the subscription?");
    expect(confirm.getByText(/90 days/)).toBeTruthy();
    fireEvent.click(confirm.getByRole("button", { name: "Keep it" }));
    expect(operate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the subscription…" }));
    fireEvent.click(form("Cancel the subscription?").getByRole("button", { name: "Yes, cancel" }));
    await vi.waitFor(() => expect(operate).toHaveBeenCalledWith("o1", { kind: "cancelSubscription" }));
  });

  test("a cancelled subscription offers only reinstating and a note", () => {
    render(<SubscriberActions sub={{ ...trialSub, status: "cancelled", purgeAfter: "2027-05-30" as CalendarDate }} status="cancelled" operate={vi.fn()} onDone={vi.fn()} now={now} />);
    expect(screen.getAllByRole("form").map((f) => f.getAttribute("aria-label"))).toEqual(["Reinstate", "Add a note"]);
  });
});

describe("Invites (PLAN-SUBSCRIBERS S3)", () => {
  const open = async (a = actions()) => {
    window.history.pushState({}, "", "/invites");
    show({ status: "ready", email: "op@sasimem.example" }, a);
    await screen.findByText("ann@kila.example");
    return a;
  };

  test("lists each invitation with its terms and whether it was used", async () => {
    await open();
    const ann = screen.getByText("ann@kila.example").closest("tr") as HTMLElement;
    expect(ann.textContent).toContain("Plus, 30-day trial");
    expect(ann.textContent).toContain("Emailed");
    const mary = screen.getByText("mary@wari.example").closest("tr") as HTMLElement;
    expect(mary.textContent).toContain("Standard, 60-day trial");
    expect(mary.textContent).toContain("Signed up");
    expect(within(mary).queryAllByRole("button")).toEqual([]); // a used invitation is never changed
    window.history.pushState({}, "", "/");
  });

  test("sends an invitation with its plan, trial and expiry; a free one has no trial field", async () => {
    const a = await open();
    const f = within(screen.getByRole("form", { name: "Invite someone" }));
    fireEvent.input(f.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.input(f.getByLabelText("Trial days"), { target: { value: "45" } });
    fireEvent.click(f.getByRole("button", { name: "Send invitation" }));
    await vi.waitFor(() => expect(a.invite).toHaveBeenCalledWith({ kind: "send", email: "new@example.com", planId: "standard", trialDays: 45, expiresInDays: 30 }));
    expect((await screen.findByRole("status")).textContent).toBe("Invitation sent to new@example.com.");
    fireEvent.change(f.getByLabelText("Plan"), { target: { value: "free" } });
    expect(f.queryByLabelText("Trial days")).toBeNull();
    window.history.pushState({}, "", "/");
  });

  test("sends again with the same terms, or revokes; a refusal shows the server's words", async () => {
    const a = await open(actions({ invite: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("There is no invitation for that email.") }));
    fireEvent.click(screen.getByRole("button", { name: "Send again to ann@kila.example" }));
    await vi.waitFor(() => expect(a.invite).toHaveBeenCalledWith({ kind: "send", email: "ann@kila.example", planId: "plus", trialDays: 30, expiresInDays: 30 }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke ann@kila.example" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There is no invitation for that email.");
    window.history.pushState({}, "", "/");
  });
});

describe("one subscriber, unknown", () => {
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
    expect((await screen.findByRole("region", { name: "The daily subscription tick" })).textContent).toMatch(/last succeeded/i);
    expect(within(screen.getByRole("region", { name: "Held runs" })).getByRole("link", { name: "Kila Trading" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Failed emails, last 30 days" }).textContent).toContain("bad@x.example");
    window.history.pushState({}, "", "/");
  });
});
