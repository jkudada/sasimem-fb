import { fireEvent, render, screen } from "@testing-library/preact";
import { type LogoDesign, LOGO_FONTS, LOGO_ICONS, LOGO_SHAPES } from "@sasimem/core/logo";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Org } from "../setup.js";
import { LogoBuilder } from "./LogoBuilder.js";
import { LOGO_PX, logoLayout } from "./layout.js";

const org: Org = {
  name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
  bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
  approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto",
};
const saved: LogoDesign = { text: "Wari", shape: "rounded", background: "#1f4e8c", colour: "#ffffff", font: "serif", icon: "palm" };
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

const logo = () => screen.getByRole("img", { name: /Your logo/ });
const pick = (name: string) => fireEvent.click(screen.getByLabelText(name));
const checked = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).checked;
const type = (text: string) => fireEvent.input(screen.getByLabelText(/^Logo text/), { target: { value: text } });

beforeAll(() => {
  render(<LogoBuilder org={org} onSave={vi.fn()} onDone={vi.fn()} draw={vi.fn()} />).unmount();
});

describe("the logo builder (docs/PLAN-TEMPLATES.md §5)", () => {
  test("starts from the org's initials on a circle, and draws the text, shape, colours, font and icon chosen", () => {
    render(<LogoBuilder org={org} onSave={vi.fn()} onDone={vi.fn()} draw={vi.fn()} />);
    expect(logo().querySelector("text")?.textContent).toBe("WH");
    expect(logo().querySelector("circle")).toBeTruthy();

    type("Wari");
    pick("Rounded square");
    fireEvent.click(screen.getAllByLabelText("Ocean")[0] as HTMLElement); // the first is the shape colour
    pick("Classic");
    pick("Palm");
    const svg = logo();
    expect(svg.getAttribute("aria-label")).toBe("Your logo: Wari");
    expect(svg.dataset).toMatchObject({ shape: "rounded", font: "serif", icon: "palm" });
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#1f4e8c");
    expect(svg.querySelector("text")?.getAttribute("fill")).toBe("#ffffff");
    expect(svg.querySelector("text")?.getAttribute("font-family")).toContain("Lora");
    expect(svg.querySelector("[data-part=icon]")).toBeTruthy();
  });

  test("with no shape there is no shape colour to pick, and the logo is a wordmark", () => {
    render(<LogoBuilder org={org} onSave={vi.fn()} onDone={vi.fn()} draw={vi.fn()} />);
    pick("No shape (a wordmark)");
    expect(screen.queryByRole("group", { name: "Shape colour" })).toBeNull();
    expect(logo().querySelector("circle, rect")).toBeNull();
  });

  test("saving draws the PNG and saves it with the choices, then goes back", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    const onDone = vi.fn();
    const draw = vi.fn().mockResolvedValue(png);
    render(<LogoBuilder org={org} onSave={onSave} onDone={onDone} draw={draw} />);
    type("  WH  ");
    pick("Star");
    fireEvent.click(screen.getByRole("button", { name: "Save logo" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled(), { interval: 5 });
    const design = { text: "WH", shape: "circle", background: "#0d6b4f", colour: "#ffffff", font: "sans", icon: "star" };
    expect(draw).toHaveBeenCalledWith(design);
    expect(onSave).toHaveBeenCalledWith(design, png);
  });

  test("reopening restores every choice", () => {
    render(<LogoBuilder org={{ ...org, logoDesign: saved }} onSave={vi.fn()} onDone={vi.fn()} draw={vi.fn()} />);
    expect((screen.getByLabelText(/^Logo text/) as HTMLInputElement).value).toBe("Wari");
    expect([checked("Rounded square"), checked("Classic"), checked("Palm")]).toEqual([true, true, true]);
    const [shapeOcean, textOcean] = screen.getAllByLabelText("Ocean") as HTMLInputElement[];
    const [, textWhite] = screen.getAllByLabelText("White") as HTMLInputElement[];
    expect([shapeOcean?.checked, textOcean?.checked, textWhite?.checked]).toEqual([true, false, true]);
  });

  test("empty text or text over 24 characters is refused with a message, and nothing is drawn or saved", () => {
    const onSave = vi.fn();
    const draw = vi.fn();
    render(<LogoBuilder org={org} onSave={onSave} onDone={vi.fn()} draw={draw} />);
    type("   ");
    fireEvent.click(screen.getByRole("button", { name: "Save logo" }));
    expect(screen.getByText("Type your initials or a short name.")).toBeTruthy();
    type("x".repeat(25));
    fireEvent.click(screen.getByRole("button", { name: "Save logo" }));
    expect(screen.getByText("Keep it to 24 characters or fewer.")).toBeTruthy();
    expect([draw, onSave].map((f) => f.mock.calls.length)).toEqual([0, 0]);
  });

  test("a failed save says so and stays on the builder", async () => {
    const onDone = vi.fn();
    render(<LogoBuilder org={org} onSave={vi.fn().mockResolvedValue("The logo could not be saved. Please try again.")} onDone={onDone} draw={vi.fn().mockResolvedValue(png)} />);
    fireEvent.click(screen.getByRole("button", { name: "Save logo" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The logo could not be saved. Please try again.");
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("the logo's layout", () => {
  test("every shape, icon and font, short or long text, stays within 400 px with the text inside", () => {
    for (const s of LOGO_SHAPES) for (const i of LOGO_ICONS) for (const f of LOGO_FONTS) for (const text of ["W", "WH", "Wari Holdings Limited 24"]) {
      const l = logoLayout({ text, shape: s.id, icon: i.id, font: f.id, background: "#1f4e8c", colour: "#1c2321" });
      expect(Math.max(l.width, l.height)).toBeLessThanOrEqual(LOGO_PX);
      const w = text.length * l.text.size * (f.id === "script" ? 0.66 : 0.6);
      const left = l.text.anchor === "middle" ? l.text.x - w / 2 : l.text.x;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + w).toBeLessThanOrEqual(l.width);
      expect(l.text.y).toBeLessThanOrEqual(l.height);
    }
  });

  test("a wordmark is as wide as its text; a badge is square", () => {
    const base: LogoDesign = { text: "WH", shape: "none", background: "#1f4e8c", colour: "#1c2321", font: "sans", icon: "none" };
    expect(logoLayout(base).width).toBeLessThan(logoLayout({ ...base, text: "Wari Holdings" }).width);
    expect(logoLayout({ ...base, shape: "circle" })).toMatchObject({ width: 400, height: 400 });
  });
});
