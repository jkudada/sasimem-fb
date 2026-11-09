import { fireEvent, render, screen } from "@testing-library/preact";
import type { CalendarDate, InvoiceTemplate, Period, TenancyDocument, Toea } from "@sasimem/core";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { MonthInvoice, Setup, WithId } from "../setup.js";
import { invoiceTemplateName } from "../template-choice.js";
import { PropertyForm } from "./PropertyForm.js";
import { Review } from "./Review.js";
import { TemplateForm } from "./TemplateForm.js";
import { TenancyForm } from "./TenancyForm.js";

// Template overrides on properties and tenancies (docs/PLAN-TEMPLATES.md, P2).
const today = "2026-10-15" as CalendarDate;
const shops: WithId<InvoiceTemplate> = { id: "t1", name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "monogram", footer: "" };
const plain: WithId<InvoiceTemplate> = { id: "t2", name: "Plain", layout: "compact", accent: "#a3312a", font: "helvetica", mark: "none", footer: "" };

const tenancy = (over: Partial<WithId<TenancyDocument>> = {}): WithId<TenancyDocument> => ({
  id: "k1", propertyId: "p1", unitId: "u1", tenantId: "t1",
  tenantName: "Peter Kila", unitLabel: "Flat 1", propertyAddress: "Lot 4, Boroko", useType: "residential",
  rentToea: 120_000 as Toea, startDate: "2026-01-01", endDate: null, billingDay: 1, dueDays: 7, referenceCode: "KILA",
  invoiced: false, extras: [], ...over,
});

const setup = (over: Partial<Setup> = {}): Setup => ({
  org: {
    name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", gstRegistered: false, gstNumber: "",
    bankName: "BSP", bankAccount: "1000", invoicePrefix: "INV-", timezone: "Pacific/Port_Moresby",
    approvalLeadDays: 3, sendHour: 8, reminderAfterDays: 7, reminderMode: "auto", defaultTemplateId: "t1",
  },
  properties: [
    { id: "p1", address: "Lot 4, Boroko", useType: "residential", units: [{ id: "u1", label: "Flat 1" }] },
    { id: "p2", address: "Lot 9, Gordons", useType: "commercial", units: [{ id: "s1", label: "Shop 1" }], templateId: "t2" },
  ],
  tenants: [{ id: "t1", name: "Peter Kila", email: "peter@kila.example", phone: "" }],
  tenancies: [tenancy()],
  templates: [plain, shops],
  ...over,
});

const forms = { onSave: vi.fn(), onDelete: vi.fn(), onDone: vi.fn() };
const tenancyForms = { onCreate: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn(), onDone: vi.fn() };
const choice = () => screen.getByLabelText(/Invoice template/) as HTMLSelectElement;
const options = () => [...choice().options].map((o) => o.text);

beforeAll(() => {
  render(<PropertyForm id="p1" setup={setup()} {...forms} />).unmount();
  render(<TenancyForm id="k1" setup={setup()} today={today} {...tenancyForms} />).unmount();
});

describe("a property's template", () => {
  test("offers 'Use default', naming the org's default, first, then the templates", () => {
    render(<PropertyForm id="p1" setup={setup()} {...forms} />);
    expect(options()).toEqual(["Use default (Shops)", "Plain", "Shops"]);
    expect(choice().value).toBe("");
  });

  // One render per test: a render is most of a T1 test's time.
  const saveProperty = (value: string) => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<PropertyForm id="p2" setup={setup()} {...forms} onSave={onSave} />);
    expect(choice().value).toBe("t2");
    fireEvent.change(choice(), { target: { value } });
    fireEvent.click(screen.getByText("Save"));
    return onSave.mock.lastCall?.[1] as Record<string, unknown>;
  };

  test("saving with a template sets templateId", () => {
    expect(saveProperty("t1")).toMatchObject({ templateId: "t1" });
  });

  test("going back to the default leaves templateId off", () => {
    expect(saveProperty("")).not.toHaveProperty("templateId");
  });

  test("with no templates there is nothing to choose", () => {
    render(<PropertyForm id="p2" setup={setup({ templates: [] })} {...forms} />);
    expect(screen.queryByLabelText(/Invoice template/)).toBeNull();
  });

  test("a deleted template shows as the default", () => {
    render(<PropertyForm id="p2" setup={setup({ templates: [shops] })} {...forms} />);
    expect(choice().value).toBe("");
  });
});

describe("a tenancy's template", () => {
  test("'Use default' names the org's default when the property has no template", () => {
    render(<TenancyForm id="k1" setup={setup()} today={today} {...tenancyForms} />);
    expect(options()).toEqual(["Use default (Shops)", "Plain", "Shops"]);
  });

  test("'Use default' names the property's template when it has one", () => {
    render(<TenancyForm id="k2" setup={setup({ tenancies: [tenancy({ id: "k2", propertyId: "p2" })] })} today={today} {...tenancyForms} />);
    expect(options()[0]).toBe("Use default (Plain)");
  });

  const saveTenancy = (value: string | null) => {
    const onUpdate = vi.fn().mockResolvedValue(null);
    render(<TenancyForm id="k1" setup={setup({ tenancies: [tenancy({ templateId: "t2" })] })} today={today} {...tenancyForms} onUpdate={onUpdate} />);
    expect(choice().value).toBe("t2");
    if (value !== null) fireEvent.change(choice(), { target: { value } });
    fireEvent.click(screen.getByText("Save"));
    return onUpdate.mock.lastCall;
  };

  test("an edit carries the chosen template", () => {
    expect(saveTenancy(null)).toEqual(["k1", expect.objectContaining({ templateId: "t2" })]);
  });

  test("an edit back to the default carries null", () => {
    expect(saveTenancy("")).toEqual(["k1", expect.objectContaining({ templateId: null })]);
  });
});

describe("which template an invoice shows", () => {
  const inv = (over: Partial<MonthInvoice> = {}): MonthInvoice => ({
    id: "k1_2026-10", tenancyId: "k1", tenantName: "Peter Kila", unitLabel: "Flat 1", status: "draft",
    rentToea: 120_000 as Toea, totalToea: 120_000 as Toea, number: null, ...over,
  });

  test("a draft shows what approval would pick now: tenancy, then property, then default", () => {
    const s = setup({ tenancies: [tenancy(), tenancy({ id: "k2", propertyId: "p2" }), tenancy({ id: "k3", propertyId: "p2", templateId: "t1" })] });
    expect(["k1", "k2", "k3"].map((id) => invoiceTemplateName(s, inv({ tenancyId: id })))).toEqual(["Shops", "Plain", "Shops"]);
  });

  test("an approved invoice shows its frozen template; before templates, Classic; with no templates at all, nothing", () => {
    expect(invoiceTemplateName(setup(), inv({ number: "INV-1", templateName: "Old name" }))).toBe("Old name");
    expect(invoiceTemplateName(setup(), inv({ number: "INV-1" }))).toBe("Classic");
    expect(invoiceTemplateName(setup({ templates: [] }), inv())).toBeNull();
    expect(invoiceTemplateName(setup({ templates: [] }), inv({ number: "INV-1", templateName: "Classic" }))).toBeNull();
  });

  test("the review screen shows each invoice's template", () => {
    const s = setup({ tenancies: [tenancy(), tenancy({ id: "k2", propertyId: "p2", tenantName: "Mary Wari" })] });
    const month = {
      period: "2026-10" as Period, status: "awaitingApproval" as const, sendAt: new Date("2026-09-30T22:00:00Z"), totalToea: 0 as Toea, invoiceCount: 2,
      invoices: [inv(), inv({ id: "k2_2026-10", tenancyId: "k2", tenantName: "Mary Wari" })],
    };
    const done = vi.fn();
    render(<Review month={month} timezone="Pacific/Port_Moresby" onSetRent={done} onExclude={done} onInclude={done} onRebuild={done} onApprove={done}
      templateName={(i) => invoiceTemplateName(s, i)} />);
    expect(screen.getAllByText(/^Template: /).map((e) => e.textContent)).toEqual(["Template: Shops", "Template: Plain"]);
  });
});

test("a template a property or tenancy uses cannot be deleted; the editor says what to do", () => {
  render(<TemplateForm id="t2" setup={setup({ tenancies: [tenancy({ templateId: "t2" })] })} onSave={vi.fn()} onDelete={vi.fn()} onPreview={vi.fn()} onDone={vi.fn()} />);
  expect(screen.queryByText("Delete template")).toBeNull();
  expect(screen.getByText("1 property and 1 tenancy use this template. Set them to another template first.")).toBeTruthy();
});
