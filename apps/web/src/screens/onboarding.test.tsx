import { fireEvent, render, screen } from "@testing-library/preact";
import type { CalendarDate } from "@sasimem/core";
import { describe, expect, test, vi } from "vitest";
import { OrgStep } from "./OrgStep.js";
import { TenancyStep } from "./TenancyStep.js";

const type = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe("onboarding: your details", () => {
  test("asks for a GST number only when registered, and refuses to go on without one, in core's words", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<OrgStep defaultEmail="mary@wari.example" onSubmit={onSubmit} />);
    expect(screen.queryByLabelText(/gst number/i)).toBeNull();
    type(/name on your invoices/i, "Wari Holdings");
    fireEvent.click(screen.getByLabelText(/registered for gst/i));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("A GST-registered landlord must enter their GST number: it is printed on every tax invoice.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("the next invoice number starts at 1, explains itself, and is sent with the details", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<OrgStep defaultEmail="mary@wari.example" onSubmit={onSubmit} />);
    const first = screen.getByLabelText(/number for your next invoice/i) as HTMLInputElement;
    expect(first.value).toBe("1");
    expect(screen.getByText(/already sent invoices by hand/i)).toBeTruthy();
    type(/name on your invoices/i, "Wari Holdings");
    type(/your address/i, "Boroko");
    type(/bank name/i, "BSP");
    type(/bank account/i, "1000 2345");
    type(/number for your next invoice/i, "142");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
      bankName: "BSP", bankAccount: "1000 2345", firstInvoiceNumber: 142,
    });
  });
});

describe("onboarding: your first tenant", () => {
  const today = "2026-09-20" as CalendarDate;

  test("the rent is read the way a landlord types it, and a mistyped or huge amount is a message, not a save", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<TenancyStep today={today} onSubmit={onSubmit} />);
    type(/monthly rent/i, "twelve hundred");
    fireEvent.click(screen.getByRole("button", { name: "Save and finish" }));
    expect(await screen.findByText("Enter an amount like K1,200.00.")).toBeTruthy();
    type(/monthly rent/i, "K20,000,000");
    fireEvent.click(screen.getByRole("button", { name: "Save and finish" }));
    expect(await screen.findByText("That is more than K10,000,000.00. Check the amount.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
