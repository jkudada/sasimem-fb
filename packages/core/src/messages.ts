/** The subjects of the emails the server sends (plan §6.6): the landlord's words, not the system's. */
import { formatKina, type Toea } from "./money.js";
import { type CalendarDate, type Period, dateLabel, periodLabel } from "./period.js";

export interface InvoiceMailFacts {
  readonly number: string;
  readonly orgName: string;
  readonly totalToea: Toea;
  readonly dueDate: CalendarDate;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const tenantInvoiceSubject = (i: InvoiceMailFacts): string =>
  `Invoice ${i.number} from ${i.orgName} - ${formatKina(i.totalToea)} due ${dateLabel(i.dueDate)}`;

export const reminderSubject = (i: InvoiceMailFacts): string =>
  `Reminder: invoice ${i.number} from ${i.orgName} - ${formatKina(i.totalToea)} was due ${dateLabel(i.dueDate)}`;

export const dispatchSubject = ({ period, count }: { period: Period; count: number }): string =>
  `Sent - your ${periodLabel(period)} ${plural(count, "invoice is with your tenant", `invoices are with your ${count} tenants`)}`;

export const heldSubject = (period: Period): string => `Held: your ${periodLabel(period)} invoices were not sent`;
