import { fireEvent, render, screen, within } from "@testing-library/preact";
import type { CalendarDate, TenancyDocument, Toea } from "@sasimem/core";
import { describe, expect, test, vi } from "vitest";
import type { Setup, WithId } from "../setup.js";
import { Home } from "./Home.js";
import { Properties } from "./Properties.js";
import { PropertyForm } from "./PropertyForm.js";
import { Settings } from "./Settings.js";
import { TenancyForm } from "./TenancyForm.js";
import { TenantForm } from "./TenantForm.js";
import { Tenants } from "./Tenants.js";

const today = "2026-10-15" as CalendarDate;
const type = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });
const choose = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

const tenancy = (over: Partial<WithId<TenancyDocument>> = {}): WithId<TenancyDocument> => ({
  id: "k1", propertyId: "p1", unitId: "u1", tenantId: "t1",
  tenantName: "Peter Kila", unitLabel: "Flat 1", propertyAddress: "Lot 4, Boroko", useType: "residential",
  rentToea: 120_000 as Toea, startDate: "2026-01-01", endDate: null, billingDay: 1, dueDays: 7, referenceCode: "KILA",
  invoiced: false, extras: [], ...over,
});

const setup = (over: Partial<Setup> = {}): Setup => ({
  org: {
    name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: true, gstNumber: "500012345",
    bankName: "BSP", bankAccount: "1000 2345", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto",
  },
  properties: [
    { id: "p1", address: "Lot 4, Boroko", useType: "residential", units: [{ id: "u1", label: "Flat 1" }, { id: "u2", label: "Flat 2" }] },
    { id: "p2", address: "Lot 9, Gordons", useType: "commercial", units: [{ id: "s1", label: "Shop 1" }] },
  ],
  tenants: [
    { id: "t1", name: "Peter Kila", email: "peter@kila.example", phone: "" },
    { id: "t2", name: "Kila Trading", email: "accounts@kila.example", phone: "7000 0000" },
  ],
  tenancies: [tenancy()],
  ...over,
});

test("home links to properties, tenants and settings, and to adding a tenancy", () => {
  const onSignOut = vi.fn();
  render(<Home setup={setup()} onSignOut={onSignOut} />);
  const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");
  expect([href(/properties/i), href(/tenants/i), href(/settings/i), href(/add a tenancy/i)]).toEqual(["/properties", "/tenants", "/settings", "/tenancies/new"]);
  click("Sign out");
  expect(onSignOut).toHaveBeenCalled();
});

describe("properties", () => {
  test("lists each address with its units, and who rents each, now or later", () => {
    const later = tenancy({ id: "k2", unitId: "u2", unitLabel: "Flat 2", tenantId: "t2", tenantName: "Kila Trading", startDate: "2026-11-01" });
    render(<Properties setup={setup({ tenancies: [tenancy(), later] })} today={today} />);
    const boroko = within(screen.getByRole("region", { name: "Lot 4, Boroko" }));
    expect(boroko.getByRole("link", { name: /Peter Kila/ }).getAttribute("href")).toBe("/tenancies/k1");
    expect(boroko.getByText(/renting now/i)).toBeTruthy();
    expect(boroko.getByText(/starts 2026-11-01/i)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Lot 9, Gordons" })).getByText(/no tenancy/i)).toBeTruthy();
  });

  test("a property's edit form saves its address, use and units", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<PropertyForm id="p1" setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={vi.fn()} />);
    type(/property address/i, "Lot 4A, Boroko");
    fireEvent.click(screen.getByLabelText(/a business uses it/i));
    type(/unit 2 name/i, "Flat 2B");
    click("Save");
    expect(onSave).toHaveBeenCalledWith("p1", {
      address: "Lot 4A, Boroko", useType: "commercial", units: [{ id: "u1", label: "Flat 1" }, { id: "u2", label: "Flat 2B" }],
    });
  });

  test("a new property starts with one unit, and more can be added", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<PropertyForm id={null} setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={vi.fn()} />);
    type(/property address/i, "Lot 2, Waigani");
    click("Add a unit");
    type(/unit 2 name/i, "Flat 2");
    click("Save");
    const [, saved] = onSave.mock.calls[0] as [null, { units: { label: string }[] }];
    expect(saved.units.map((u) => u.label)).toEqual(["Whole property", "Flat 2"]);
  });

  test("core's problems are shown, and a unit someone rents cannot be removed", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<PropertyForm id="p1" setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={vi.fn()} />);
    type(/property address/i, " ");
    click("Remove Flat 1");
    click("Save");
    expect(await screen.findByText("Enter the property's address.")).toBeTruthy();
    expect(screen.getByText("Flat 1 has a tenancy, so it cannot be removed. You can rename it.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a property with a tenancy cannot be deleted; one without can", async () => {
    const onDelete = vi.fn().mockResolvedValue(null);
    const { unmount } = render(<PropertyForm id="p1" setup={setup()} onSave={vi.fn()} onDelete={onDelete} onDone={vi.fn()} />);
    click("Delete this property");
    expect(await screen.findByText("This has a tenancy. End or delete the tenancy first.")).toBeTruthy();
    unmount();
    render(<PropertyForm id="p2" setup={setup()} onSave={vi.fn()} onDelete={onDelete} onDone={vi.fn()} />);
    click("Delete this property");
    expect(onDelete).toHaveBeenCalledWith("p2");
  });
});

describe("tenants", () => {
  test("lists each tenant's name and email, linking to their details", () => {
    render(<Tenants setup={setup()} />);
    expect(screen.getByRole("link", { name: /Kila Trading/ }).getAttribute("href")).toBe("/tenants/t2");
    expect(screen.getByText("accounts@kila.example")).toBeTruthy();
    expect(screen.getByRole("link", { name: /add a tenant/i }).getAttribute("href")).toBe("/tenants/new");
  });

  test("the tenant form shows core's problems and saves name, email and phone", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<TenantForm id="t2" setup={setup()} onSave={onSave} onDelete={vi.fn()} onDone={vi.fn()} />);
    type(/tenant's email/i, "accounts");
    click("Save");
    expect(await screen.findByText("Enter an email address like name@example.com.")).toBeTruthy();
    type(/tenant's email/i, "pay@kila.example");
    click("Save");
    expect(onSave).toHaveBeenCalledWith("t2", { name: "Kila Trading", email: "pay@kila.example", phone: "7000 0000" });
  });

  test("a tenant with a tenancy cannot be deleted", async () => {
    const onDelete = vi.fn();
    render(<TenantForm id="t1" setup={setup()} onSave={vi.fn()} onDelete={onDelete} onDone={vi.fn()} />);
    click("Delete this tenant");
    expect(await screen.findByText("This has a tenancy. End or delete the tenancy first.")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("tenancies", () => {
  const forms = { onCreate: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn(), onDone: vi.fn() };

  test("a new tenancy picks a property, unit and tenant, and its document is built by core", async () => {
    const onCreate = vi.fn().mockResolvedValue(null);
    render(<TenancyForm id={null} setup={setup({ tenancies: [] })} today={today} {...forms} onCreate={onCreate} />);
    choose(/property/i, "p2");
    choose(/^unit/i, "s1");
    choose(/^tenant/i, "t2");
    type(/monthly rent/i, "K2,400.50");
    type(/payment reference/i, "kila");
    click("Save");
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: "p2", unitId: "s1", tenantId: "t2", tenantName: "Kila Trading", unitLabel: "Shop 1",
      propertyAddress: "Lot 9, Gordons", useType: "commercial", rentToea: 240_050, startDate: "2026-10-15", referenceCode: "KILA",
    }));
  });

  test("charges are added with amounts in kina, credits allowed, and saved with the terms", async () => {
    const onUpdate = vi.fn().mockResolvedValue(null);
    render(<TenancyForm id="k1" setup={setup()} today={today} {...forms} onUpdate={onUpdate} />);
    click("Add a charge");
    type(/charge 1 description/i, "Water");
    type(/charge 1 amount/i, "K50");
    click("Add a charge");
    type(/charge 2 description/i, "Repair credit");
    type(/charge 2 amount/i, "-K20.00");
    choose(/charge 2 how often/i, "one");
    type(/charge 2 month/i, "2026-11");
    click("Save");
    const [, edit] = onUpdate.mock.calls[0] as [string, { extras: { description: string; amountToea: number; recurrence: string; period: string | null }[] }];
    expect(edit.extras.map(({ description, amountToea, recurrence, period }) => ({ description, amountToea, recurrence, period }))).toEqual([
      { description: "Water", amountToea: 5_000, recurrence: "every", period: null },
      { description: "Repair credit", amountToea: -2_000, recurrence: "one", period: "2026-11" },
    ]);
  });

  const water = { id: "c1", description: "Water", amountToea: 5_000 as Toea, recurrence: "every" as const, period: null, active: true, gstTreatment: "inherit" as const };

  test("a charge can be paused or removed", async () => {
    const onUpdate = vi.fn().mockResolvedValue(null);
    render(<TenancyForm id="k1" setup={setup({ tenancies: [tenancy({ extras: [water, { ...water, id: "c2", description: "Power" }] })] })} today={today} {...forms} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText(/charge 1 paused/i));
    click("Remove charge 2");
    click("Save");
    expect(onUpdate).toHaveBeenCalledWith("k1", expect.objectContaining({ extras: [{ ...water, active: false }] }));
  });

  test("a charge with no description is a message, not a save", async () => {
    const onUpdate = vi.fn().mockResolvedValue(null);
    render(<TenancyForm id="k1" setup={setup()} today={today} {...forms} onUpdate={onUpdate} />);
    click("Add a charge");
    click("Save");
    expect(await screen.findByText("Say what the charge is for, such as Water.")).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("GST on a charge reads 'same as the rent', and says which way that falls here", () => {
    render(<TenancyForm id="k1" setup={setup()} today={today} {...forms} />);
    click("Add a charge");
    const gst = screen.getByLabelText(/charge 1 gst/i) as HTMLSelectElement;
    expect(gst.selectedOptions[0]?.textContent).toBe("Same as the rent (no GST)");
    expect(screen.getByText(/a tool, not an accountant/i)).toBeTruthy();
  });

  test("ending a tenancy sets its end date; it can be deleted only if it was never invoiced", async () => {
    const onUpdate = vi.fn().mockResolvedValue(null);
    const { unmount } = render(<TenancyForm id="k1" setup={setup({ tenancies: [tenancy({ invoiced: true })] })} today={today} {...forms} onUpdate={onUpdate} />);
    expect(screen.queryByRole("button", { name: "Delete this tenancy" })).toBeNull();
    expect(screen.getByText(/has been invoiced, so it can be ended but not deleted/i)).toBeTruthy();
    type(/end date/i, "2026-12-31");
    click("Save");
    expect(onUpdate).toHaveBeenCalledWith("k1", expect.objectContaining({ endDate: "2026-12-31" }));
    unmount();
    const onDelete = vi.fn().mockResolvedValue(null);
    render(<TenancyForm id="k1" setup={setup()} today={today} {...forms} onDelete={onDelete} />);
    click("Delete this tenancy");
    expect(onDelete).toHaveBeenCalledWith("k1");
  });
});

describe("settings", () => {
  const props = { onSave: vi.fn(), onUploadLogo: vi.fn(), onRemoveLogo: vi.fn(), onSetNext: vi.fn(), logoUrl: null };

  test("edits letterhead, bank, GST and timing, checked by core, and saves the profile", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<Settings org={setup().org} numbering={{ next: 1, started: false }} {...props} onSave={onSave} />);
    type(/gst number/i, " ");
    click("Save settings");
    expect(await screen.findByText(/must enter their GST number/)).toBeTruthy();
    type(/gst number/i, "500099999");
    type(/bank account/i, "2000 1111");
    type(/hour to send/i, "9");
    fireEvent.click(screen.getByLabelText(/remind tenants/i));
    click("Save settings");
    expect(onSave).toHaveBeenCalledWith({ ...setup().org, gstNumber: "500099999", bankAccount: "2000 1111", sendHour: 9, reminderMode: "off" });
  });

  test("a logo that is not a picture, or is over 200 KB, is refused before upload", async () => {
    const onUploadLogo = vi.fn().mockResolvedValue(null);
    render(<Settings org={setup().org} numbering={{ next: 1, started: false }} {...props} onUploadLogo={onUploadLogo} />);
    const pick = (file: File) => fireEvent.change(screen.getByLabelText(/logo/i), { target: { files: [file] } });
    pick(new File(["x"], "terms.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Choose a picture: PNG, JPEG, WebP or GIF.")).toBeTruthy();
    pick(new File([new Uint8Array(200 * 1024 + 1)], "big.png", { type: "image/png" }));
    expect(await screen.findByText("Choose a logo smaller than 200 KB.")).toBeTruthy();
    expect(onUploadLogo).not.toHaveBeenCalled();
    const ok = new File(["x"], "logo.png", { type: "image/png" });
    pick(ok);
    expect(onUploadLogo).toHaveBeenCalledWith(ok);
  });

  test("the next invoice number can be changed until numbering starts, then says why not", async () => {
    const onSetNext = vi.fn().mockResolvedValue(null);
    const { unmount } = render(<Settings org={setup().org} numbering={{ next: 1, started: false }} {...props} onSetNext={onSetNext} />);
    type(/number for your next invoice/i, "142");
    click("Save number");
    expect(onSetNext).toHaveBeenCalledWith(142);
    unmount();
    render(<Settings org={setup().org} numbering={{ next: 143, started: true }} {...props} />);
    expect(screen.getByText(/your next invoice will be INV-0143/i)).toBeTruthy();
    expect(screen.getByText(/already been numbered/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save number" })).toBeNull();
  });
});
