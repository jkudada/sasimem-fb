/** Every email the server sends (plan §6.6). Plain text; the landlord's words, not the system's. */
import {
  type CalendarDate, type InvoiceSnapshot, type Period, type Toea,
  dateLabel, digestSubject, dispatchSubject, formatKina, heldSubject, periodLabel, reminderSubject, tenantInvoiceSubject,
} from "@sasimem/core";
import type { Mail } from "./mailer.js";

/** "8:00 am, Thursday 1 October 2026", in the landlord's time. */
export function whenLabel(at: Date, timezone: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: timezone, ...o }).format(at);
  return `${f({ hour: "numeric", minute: "2-digit", hour12: true })}, ${f({ weekday: "long" })} ${f({ day: "numeric", month: "long", year: "numeric" })}`;
}

const WARNING = "This link works for 7 days. Do not forward it: anyone who has it can approve these invoices.";

/** late: asked for after the send time, so the run is already held and goes out within the hour of approval. */
export function approvalDigest(req: { to: string; orgName: string; period: Period; count: number; totalToea: Toea; link: string; sendAt: Date; timezone: string; late?: boolean }): Mail {
  return {
    to: req.to,
    subject: digestSubject(req),
    text: [
      `Hello ${req.orgName},`,
      "",
      `Your ${periodLabel(req.period)} invoices are ready for you to check: ${req.count} ${req.count === 1 ? "invoice" : "invoices"}, ${formatKina(req.totalToea)}.`,
      "",
      "Check and approve them here:",
      req.link,
      "",
      req.late === true
        ? `Nothing goes to your tenants until you approve. These were due to go out at ${whenLabel(req.sendAt, req.timezone)}, so once you approve, they go out within the hour.`
        : `Nothing goes to your tenants until you approve. Approved invoices go out at ${whenLabel(req.sendAt, req.timezone)}. If you have not approved by then, they are held, not sent.`,
      "",
      WARNING,
    ].join("\n"),
  };
}

export function freshLink(req: { to: string; orgName: string; period: Period; link: string }): Mail {
  return {
    to: req.to,
    subject: `Your new approval link for ${periodLabel(req.period)}`,
    text: [
      `Hello ${req.orgName},`,
      "",
      `Here is a new link to check and approve your ${periodLabel(req.period)} invoices. Earlier links no longer work.`,
      "",
      req.link,
      "",
      WARNING,
    ].join("\n"),
  };
}

export function heldNotice(req: { to: string; orgName: string; period: Period; link: string; sendAt: Date; timezone: string }): Mail {
  return {
    to: req.to,
    subject: heldSubject(req.period),
    text: [
      `Hello ${req.orgName},`,
      "",
      `Your ${periodLabel(req.period)} invoices were not approved by ${whenLabel(req.sendAt, req.timezone)}, so nothing was sent to your tenants.`,
      "",
      "Check and approve them here, and they go out within the hour:",
      req.link,
      "",
      "The link in the earlier email works too.",
      "",
      WARNING,
    ].join("\n"),
  };
}

export interface DispatchLine {
  readonly tenantName: string;
  readonly number: string;
  readonly totalToea: Toea;
  readonly sent: boolean;
}

export function dispatchNotice(req: { to: string; orgName: string; period: Period; lines: readonly DispatchLine[] }): Mail {
  const sent = req.lines.filter((l) => l.sent);
  const failed = req.lines.filter((l) => !l.sent);
  const total = sent.reduce((t, l) => t + l.totalToea, 0) as Toea;
  return {
    to: req.to,
    subject: dispatchSubject({ period: req.period, count: sent.length }),
    text: [
      `Hello ${req.orgName},`,
      "",
      `Your ${periodLabel(req.period)} invoices have gone out, each with its PDF attached. Tenants' replies come to you.`,
      "",
      ...req.lines.map((l) => `${l.tenantName}: ${l.sent ? `${l.number}, ${formatKina(l.totalToea)}` : `not sent - check their email address (${l.number})`}`),
      "",
      `Total sent: ${formatKina(total)}`,
      ...(failed.length > 0 ? ["", `${failed.length === 1 ? "One invoice was" : `${failed.length} invoices were`} not sent. Correct the email address, then send it from the invoices screen.`] : []),
    ].join("\n"),
  };
}

/** The facts a tenant's email states, all from the invoice as approved. */
export interface TenantInvoiceFacts {
  readonly snapshot: InvoiceSnapshot;
  readonly number: string;
  readonly documentTitle: string;
  readonly period: Period;
  readonly totalToea: Toea;
  readonly dueDate: CalendarDate;
  readonly paymentReference: string;
  readonly pdf: Buffer;
}

/** INV/0142 → INV-0142.pdf: a prefix can hold characters a file name cannot. */
export const pdfFilename = (number: string): string => `${number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;

function payTo(i: TenantInvoiceFacts): string[] {
  return [
    `Amount: ${formatKina(i.totalToea)}`,
    `Due: ${dateLabel(i.dueDate)}`,
    "",
    `Pay to: ${i.snapshot.org.bankName}, account ${i.snapshot.org.bankAccount}`,
    `Payment reference: ${i.paymentReference}`,
  ];
}

function tenantMail(i: TenantInvoiceFacts, subject: string, opening: string[]): Mail {
  return {
    to: i.snapshot.tenantEmail,
    fromName: i.snapshot.org.name,
    replyTo: i.snapshot.org.email,
    subject,
    text: [
      `Hello ${i.snapshot.tenantName},`,
      "",
      ...opening,
      "",
      ...payTo(i),
      "",
      `To ask about this invoice, reply to this email to reach ${i.snapshot.org.name}.`,
    ].join("\n"),
    attachments: [{ filename: pdfFilename(i.number), content: i.pdf }],
  };
}

export function tenantInvoice(i: TenantInvoiceFacts): Mail {
  const where = [i.snapshot.unitLabel, i.snapshot.propertyAddress].filter((s) => s !== "").join(", ");
  return tenantMail(i, tenantInvoiceSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: i.totalToea, dueDate: i.dueDate }), [
    `${i.snapshot.org.name} has sent you ${i.documentTitle === "TAX INVOICE" ? "tax invoice" : "invoice"} ${i.number} for ${where}, ${periodLabel(i.period)}. The PDF is attached.`,
  ]);
}

export function tenantReminder(i: TenantInvoiceFacts): Mail {
  return tenantMail(i, reminderSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: i.totalToea, dueDate: i.dueDate }), [
    `This is a reminder that invoice ${i.number} from ${i.snapshot.org.name} was due on ${dateLabel(i.dueDate)}. The PDF is attached again.`,
    "",
    "If you have already paid, thank you, and please ignore this email.",
  ]);
}
