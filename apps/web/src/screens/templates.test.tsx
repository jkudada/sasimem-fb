import { fireEvent, render, screen, within } from "@testing-library/preact";
import { CLASSIC, type InvoiceTemplate } from "@sasimem/core";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Setup, WithId } from "../setup.js";
import { TemplateForm } from "./TemplateForm.js";
import { Templates } from "./Templates.js";

const shops: WithId<InvoiceTemplate> = { id: "t1", name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "monogram", footer: "" };
const houses: WithId<InvoiceTemplate> = { id: "t2", name: "Houses", layout: "compact", accent: "#a3312a", font: "helvetica", mark: "none", footer: "Thank you." };

const setup = (over: Partial<Setup["org"]> = {}, templates: readonly WithId<InvoiceTemplate>[] = [shops, houses]): Setup => ({
  org: {
    name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
    bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto", ...over,
  },
  properties: [], tenants: [], tenancies: [], templates,
});
// The first render of these screens pays for warming up the renderer: pay it once
// here, not in whichever test runs first (as the T3 harness does for Firestore).
beforeAll(() => {
  render(<TemplateForm id={null} setup={setup()} onSave={vi.fn()} onDelete={vi.fn()} onPreview={vi.fn()} onDone={vi.fn()} />).unmount();
  render(<Templates setup={setup()} onSetDefault={vi.fn()} />).unmount();
});

const sections = () => screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
const sketch = () => screen.getByRole("img", { name: /Sketch of the/ });

describe("the templates list", () => {
  test("the default comes first and says so; the rest, then built-in Classic, can be made the default", async () => {
    const onSetDefault = vi.fn().mockResolvedValue(null);
    render(<Templates setup={setup({ defaultTemplateId: "t2" })} onSetDefault={onSetDefault} />);
    expect(sections()).toEqual(["Houses", "Shops", "Classic (built in)"]);
    expect(within(screen.getByRole("region", { name: "Houses" })).getByText(/Default: used for every invoice/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Shops" })).getByRole("button", { name: "Make default" }));
    expect(onSetDefault).toHaveBeenCalledWith("t1");
    expect(await screen.findByRole("status")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Classic (built in)" })).getByRole("button", { name: "Make default" }));
    expect(onSetDefault).toHaveBeenLastCalledWith(null);
  });

  test("with no default, or one that was deleted, built-in Classic is the default", () => {
    const { unmount } = render(<Templates setup={setup()} onSetDefault={vi.fn()} />);
    expect(sections()[0]).toBe("Classic (built in)");
    unmount();
    render(<Templates setup={setup({ defaultTemplateId: "gone" })} onSetDefault={vi.fn()} />);
    expect(within(screen.getByRole("region", { name: "Classic (built in)" })).getByText(/Default/)).toBeTruthy();
  });

  test("each template links to its editor, and there is a link to make a new one", () => {
    render(<Templates setup={setup()} onSetDefault={vi.fn()} />);
    expect(within(screen.getByRole("region", { name: "Shops" })).getByText("Band · Ocean · Traditional")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit Shops" }).getAttribute("href")).toBe("/settings/templates/t1");
    expect(screen.getByRole("link", { name: "New template" }).getAttribute("href")).toBe("/settings/templates/new");
  });

  test("at 10 templates there is no new one, and the screen says why", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...shops, id: `t${i}`, name: `T${i}` }));
    render(<Templates setup={setup({}, ten)} onSetDefault={vi.fn()} />);
    expect(screen.queryByText("New template")).toBeNull(); // by text, not role: role queries over 11 sketches are slow
    expect(screen.getByText(/10 templates, the most you can keep/)).toBeTruthy();
  });
});

describe("a template's editor", () => {
  const forms = { onSave: vi.fn(), onDelete: vi.fn(), onPreview: vi.fn(), onDone: vi.fn() };

  test("a first template is saved with its settings, as the default unless unticked", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    const onDone = vi.fn();
    render(<TemplateForm id={null} setup={setup({}, [])} {...forms} onSave={onSave} onDone={onDone} />);
    fireEvent.input(screen.getByLabelText(/Template name/), { target: { value: " Shops " } });
    fireEvent.click(screen.getByLabelText(/^Band/));
    fireEvent.click(screen.getByLabelText("Ocean"));
    fireEvent.input(screen.getByLabelText(/Note on every invoice/), { target: { value: "Thank you." } });
    expect((screen.getByLabelText(/for all my invoices/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled(), { interval: 5 });
    expect(onSave).toHaveBeenCalledWith(null, { name: "Shops", layout: "band", accent: "#1f4e8c", font: "helvetica", mark: "logo", footer: "Thank you." }, true);
  });

  test("a template with no name is not saved, and says why", () => {
    const onSave = vi.fn();
    render(<TemplateForm id={null} setup={setup()} {...forms} onSave={onSave} />);
    expect((screen.getByLabelText(/for all my invoices/) as HTMLInputElement).checked).toBe(true); // no default yet, only built-in Classic
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(screen.getByText(/Give the template a name/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("the sketch follows the layout, colour and font as they change", () => {
    render(<TemplateForm id={null} setup={setup()} {...forms} />);
    expect(sketch().dataset).toMatchObject({ layout: "classic", accent: CLASSIC.accent, font: "helvetica" });
    fireEvent.click(screen.getByLabelText(/^Compact/));
    fireEvent.click(screen.getByLabelText("Brick"));
    fireEvent.click(screen.getByLabelText(/Traditional/));
    expect(sketch().dataset).toMatchObject({ layout: "compact", accent: "#a3312a", font: "times" });
    expect(sketch().querySelector("[data-mark=monogram]")).not.toBeNull(); // no logo uploaded: the initials
  });

  test("the sketch drops the letterhead mark for nothing, and shows the note when there is one", () => {
    render(<TemplateForm id={null} setup={setup()} {...forms} />);
    fireEvent.click(screen.getByLabelText(/Nothing, just your name/));
    expect(sketch().querySelector("[data-mark]")).toBeNull();
    fireEvent.input(screen.getByLabelText(/Note on every invoice/), { target: { value: "Hi" } });
    expect(sketch().querySelector("[data-note]")).not.toBeNull();
  });

  test("with a logo uploaded, the sketch shows a logo", () => {
    render(<TemplateForm id={null} setup={setup({ logoPath: "logos/o/1.png" })} {...forms} />);
    expect(sketch().querySelector("[data-mark=logo]")).not.toBeNull();
  });

  test("the sample PDF uses the settings on screen, saved or not, and says what happened", async () => {
    const onPreview = vi.fn().mockResolvedValue({ ok: true, message: "The sample PDF has downloaded." });
    render(<TemplateForm id="t1" setup={setup()} {...forms} onPreview={onPreview} />);
    fireEvent.click(screen.getByLabelText(/^Classic/));
    fireEvent.click(screen.getByRole("button", { name: "See a sample PDF" }));
    expect(await screen.findByText("The sample PDF has downloaded.")).toBeTruthy();
    const { id: _, ...settings } = shops;
    expect(onPreview).toHaveBeenCalledWith({ ...settings, layout: "classic" });
  });

  test("the default template cannot be deleted, and the screen says what to do instead", () => {
    render(<TemplateForm id="t1" setup={setup({ defaultTemplateId: "t1" })} {...forms} />);
    expect(screen.queryByRole("button", { name: "Delete template" })).toBeNull();
    expect(screen.getByText(/cannot be deleted/)).toBeTruthy();
    expect(screen.queryByLabelText(/for all my invoices/)).toBeNull();
  });

  test("another template can be deleted, and editing it keeps the default unless ticked", async () => {
    const onDelete = vi.fn().mockResolvedValue(null);
    const onSave = vi.fn().mockResolvedValue(null);
    const onDone = vi.fn();
    render(<TemplateForm id="t2" setup={setup({ defaultTemplateId: "t1" })} {...forms} onDelete={onDelete} onSave={onSave} onDone={onDone} />);
    expect((screen.getByLabelText(/for all my invoices/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { interval: 5 });
    expect(onSave).toHaveBeenCalledWith("t2", { name: "Houses", layout: "compact", accent: "#a3312a", font: "helvetica", mark: "none", footer: "Thank you." }, false);
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith("t2"), { interval: 5 });
  });
});
