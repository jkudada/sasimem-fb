/**
 * Test builders (plan §9.1): each test states only what matters to it.
 *   aTenancy().commercial().withRent("K1,200").build()
 * Defaults describe an ordinary residential tenancy billed on the 1st, due in 7 days.
 */
import { parseKina } from "../src/money.js";
import type { CalendarDate, Period } from "../src/period.js";
import type { BillingOrg, Charge, GstTreatment, Tenancy } from "../src/types.js";

class TenancyBuilder {
  private t: Tenancy = {
    id: "tenancy-1",
    tenantName: "Mary Kila",
    unitLabel: "Flat 2",
    useType: "residential",
    rentToea: parseKina("K1,200"),
    startDate: "2026-01-01" as CalendarDate,
    endDate: null,
    billingDay: 1,
    dueDays: 7,
    referenceCode: "wari",
    extras: [],
  };
  id(id: string): this { this.t = { ...this.t, id }; return this; }
  tenant(tenantName: string): this { this.t = { ...this.t, tenantName }; return this; }
  unit(unitLabel: string): this { this.t = { ...this.t, unitLabel }; return this; }
  commercial(): this { this.t = { ...this.t, useType: "commercial" }; return this; }
  residential(): this { this.t = { ...this.t, useType: "residential" }; return this; }
  withRent(kina: string): this { this.t = { ...this.t, rentToea: parseKina(kina) }; return this; }
  starting(date: string): this { this.t = { ...this.t, startDate: date as CalendarDate }; return this; }
  ending(date: string): this { this.t = { ...this.t, endDate: date as CalendarDate }; return this; }
  billedOn(billingDay: number): this { this.t = { ...this.t, billingDay }; return this; }
  dueIn(dueDays: number): this { this.t = { ...this.t, dueDays }; return this; }
  reference(referenceCode: string): this { this.t = { ...this.t, referenceCode }; return this; }
  withCharge(charge: Charge): this { this.t = { ...this.t, extras: [...this.t.extras, charge] }; return this; }
  build(): Tenancy { return this.t; }
}

class ChargeBuilder {
  private c: Charge;
  constructor(description: string) {
    this.c = { id: `charge-${description}`, description, amountToea: parseKina("K50"), recurrence: "every", period: null, active: true, gstTreatment: "inherit" };
  }
  amount(kina: string): this { this.c = { ...this.c, amountToea: parseKina(kina) }; return this; }
  every(): this { this.c = { ...this.c, recurrence: "every", period: null }; return this; }
  onlyIn(period: string): this { this.c = { ...this.c, recurrence: "one", period: period as Period }; return this; }
  treatment(gstTreatment: GstTreatment): this { this.c = { ...this.c, gstTreatment }; return this; }
  inactive(): this { this.c = { ...this.c, active: false }; return this; }
  build(): Charge { return this.c; }
}

class OrgBuilder {
  private o: BillingOrg = {
    gstRegistered: false,
    timezone: "Pacific/Port_Moresby",
    sendHour: 8,
    approvalLeadDays: 3,
    reminderAfterDays: 7,
    reminderMode: "auto",
  };
  gstRegistered(): this { this.o = { ...this.o, gstRegistered: true }; return this; }
  sendingAt(sendHour: number): this { this.o = { ...this.o, sendHour }; return this; }
  leadDays(approvalLeadDays: number): this { this.o = { ...this.o, approvalLeadDays }; return this; }
  remindAfter(reminderAfterDays: number): this { this.o = { ...this.o, reminderAfterDays }; return this; }
  remindersOff(): this { this.o = { ...this.o, reminderMode: "off" }; return this; }
  inTimezone(timezone: string): this { this.o = { ...this.o, timezone }; return this; }
  build(): BillingOrg { return this.o; }
}

export const aTenancy = (): TenancyBuilder => new TenancyBuilder();
export const aCharge = (description = "Water"): ChargeBuilder => new ChargeBuilder(description);
export const anOrg = (): OrgBuilder => new OrgBuilder();
