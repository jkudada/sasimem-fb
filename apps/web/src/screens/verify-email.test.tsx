import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { signUpMessage } from "../auth-messages.js";
import { SignUp } from "./SignUp.js";
import { VerifyEmail } from "./VerifyEmail.js";

// Sign-up (docs/PLAN-TEMPLATES.md §7): confirm the email before an organisation; a closed sign-up says so.
const verify = (over: Partial<Parameters<typeof VerifyEmail>[0]> = {}) => ({
  email: "mary@wari.example", onCheck: vi.fn().mockResolvedValue(false), onResend: vi.fn().mockResolvedValue(null), onSignOut: vi.fn().mockResolvedValue(undefined), ...over,
});

// Pay the renderer's first-render cost here, not in a test (held to 100 ms).
beforeAll(() => {
  render(<VerifyEmail {...verify()} />).unmount();
  render(<SignUp onSignUp={vi.fn()} open />).unmount();
});

describe("after sign-up, the onboarding screen asks the user to confirm their email", () => {
  test("not confirmed yet says so; sending again says where to look", async () => {
    const props = verify();
    render(<VerifyEmail {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "I have opened the link" }));
    expect(await screen.findByText("Not confirmed yet. Open the link in the email, then try again.")).toBeTruthy();
    await vi.waitFor(() => expect((screen.getByRole("button", { name: "Send the link again" }) as HTMLButtonElement).disabled).toBe(false), { interval: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(await screen.findByText("Sent again. Check your inbox, and your spam folder.")).toBeTruthy();
    expect(props.onResend).toHaveBeenCalledTimes(1);
  });

  test("the wrong address can sign out", () => {
    const props = verify();
    render(<VerifyEmail {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(props.onSignOut).toHaveBeenCalled();
  });
});

describe("a refused sign-up", () => {
  test('shows "Sign-up is by invitation for now", not "Something went wrong"', async () => {
    for (const code of ["auth/admin-restricted-operation", "auth/operation-not-allowed"]) expect(signUpMessage(code)).toMatch(/^Sign-up is by invitation for now/);
    expect(signUpMessage("auth/email-already-in-use")).toBe("There is already an account for that email. Sign in instead.");
    render(<SignUp onSignUp={vi.fn().mockResolvedValue(signUpMessage("auth/admin-restricted-operation"))} open />);
    fireEvent.input(screen.getByLabelText(/email/i), { target: { value: "new@wari.example" } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Sign-up is by invitation for now. Ask Sasimem for an invitation for this email address.");
  });
});
