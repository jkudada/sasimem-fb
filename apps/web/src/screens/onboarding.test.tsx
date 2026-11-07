import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import { OrgStep } from "./OrgStep.js";

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
});
