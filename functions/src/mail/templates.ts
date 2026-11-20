/**
 * Every email the server sends (plan §6.6): the landlord's words, not the system's.
 * Each is a Letter (letter.ts), sent as plain text and as HTML that says the same.
 * Tenants' emails wear the invoice's frozen template; landlords' the house style.
 */
import {
  CLASSIC, type CalendarDate, defaultPlan, localDate, type PlanId, SUBSCRIPTION_TIMEZONE, type InvoiceSnapshot, type Period, type Toea,
  dateLabel, digestSubject, dispatchSubject, formatKina, heldSubject, periodLabel, reminderSubject, tenantInvoiceSubject,
} from "@sasimem/core";
import { fitInside } from "../png.js";
import { type Brand, HOUSE, type Letter, letterHtml, letterText } from "./letter.js";
import type { Mail } from "./mailer.js";

/** "8:00 am, Thursday 1 October 2026", in the landlord's time. */
export function whenLabel(at: Date, timezone: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: timezone, ...o }).format(at);
  return `${f({ hour: "numeric", minute: "2-digit", hour12: true })}, ${f({ weekday: "long" })} ${f({ day: "numeric", month: "long", year: "numeric" })}`;
}

/** A landlord's email: the text and the house-style HTML from one letter. */
const toLandlord = (to: string, subject: string, letter: Letter): Mail =>
  ({ to, subject, text: letterText(letter), html: letterHtml(letter, HOUSE, subject) });

const WARNING = "This link works for 7 days. Do not forward it: anyone who has it can approve these invoices.";

/** late: asked for after the send time, so the run is already held and goes out within the hour of approval. */
export function approvalDigest(req: { to: string; orgName: string; period: Period; count: number; totalToea: Toea; link: string; sendAt: Date; timezone: string; late?: boolean }): Mail {
  return toLandlord(req.to, digestSubject(req), {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: `Your ${periodLabel(req.period)} invoices are ready for you to check: ${req.count} ${req.count === 1 ? "invoice" : "invoices"}, ${formatKina(req.totalToea)}.` },
      { p: "Check and approve them here:", link: req.link },
      {
        p: req.late === true
          ? `Nothing goes to your tenants until you approve. These were due to go out at ${whenLabel(req.sendAt, req.timezone)}, so once you approve, they go out within the hour.`
          : `Nothing goes to your tenants until you approve. Approved invoices go out at ${whenLabel(req.sendAt, req.timezone)}. If you have not approved by then, they are held, not sent.`,
      },
      { p: WARNING },
    ],
  });
}

export function freshLink(req: { to: string; orgName: string; period: Period; link: string }): Mail {
  return toLandlord(req.to, `Your new approval link for ${periodLabel(req.period)}`, {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: `Here is a new link to check and approve your ${periodLabel(req.period)} invoices. Earlier links no longer work.` },
      { link: req.link },
      { p: WARNING },
    ],
  });
}

export function freshTrackingLink(req: { to: string; orgName: string; period: Period; link: string }): Mail {
  return toLandlord(req.to, `Your new link for ${periodLabel(req.period)}`, {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: `Here is a new link to see who has paid their ${periodLabel(req.period)} invoices, and to tick them paid:`, link: req.link },
      { p: "Everything still owed, across all months:", link: `${req.link}/owed` },
      { p: "These links work for 60 days. Do not forward them." },
    ],
  });
}

export function heldNotice(req: { to: string; orgName: string; period: Period; link: string; sendAt: Date; timezone: string }): Mail {
  return toLandlord(req.to, heldSubject(req.period), {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: `Your ${periodLabel(req.period)} invoices were not approved by ${whenLabel(req.sendAt, req.timezone)}, so nothing was sent to your tenants.` },
      { p: "Check and approve them here, and they go out within the hour:", link: req.link },
      { p: "The link in the earlier email works too." },
      { p: WARNING },
    ],
  });
}

/** A scheduled one-off the tick could not send (G2d): what, why, and where to put it right. Nothing was numbered. */
export function notSentNotice(req: { to: string; orgName: string; customerName: string; sendAt: Date; timezone: string; problem: string; link: string }): Mail {
  return toLandlord(req.to, `Not sent: your invoice for ${req.customerName}`, {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: `Your invoice was due to go to ${req.customerName} at ${whenLabel(req.sendAt, req.timezone)}, but was not sent: ${req.problem}` },
      { p: "It is still a draft, and nothing was numbered. Put it right and send it, or schedule it again, here:", link: req.link },
    ],
  });
}

export function sentScheduledNotice(req: { to: string; orgName: string; customerName: string; number: string; totalToea: Toea; sendAt: Date; timezone: string; link: string }): Mail {
  return toLandlord(req.to, `Sent as scheduled: ${req.number} to ${req.customerName}`, {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: `Your invoice ${req.number} for ${formatKina(req.totalToea)} went to ${req.customerName} at ${whenLabel(req.sendAt, req.timezone)}, as you scheduled, with its PDF attached.` },
      { p: "See your one-off invoices:", link: req.link },
      { p: "To stop these notes, switch off \"Email me when a scheduled invoice goes\" in Settings." },
    ],
  });
}

export interface DispatchLine {
  readonly tenantName: string;
  readonly number: string;
  readonly totalToea: Toea;
  readonly sent: boolean;
}

export function dispatchNotice(req: { to: string; orgName: string; period: Period; lines: readonly DispatchLine[]; trackLink: string }): Mail {
  const sent = req.lines.filter((l) => l.sent);
  const failed = req.lines.filter((l) => !l.sent);
  const total = sent.reduce((t, l) => t + l.totalToea, 0) as Toea;
  return toLandlord(req.to, dispatchSubject({ period: req.period, count: sent.length }), {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: `Your ${periodLabel(req.period)} invoices have gone out, each with its PDF attached. Tenants' replies come to you.` },
      { rows: req.lines.map((l) => [l.tenantName, l.sent ? `${l.number}, ${formatKina(l.totalToea)}` : `not sent - check their email address (${l.number})`] as const) },
      { p: `Total sent: ${formatKina(total)}` },
      ...(failed.length > 0 ? [{ p: `${failed.length === 1 ? "One invoice was" : `${failed.length} invoices were`} not sent. Correct the email address, then use "Email again" on the month's invoices in Sasimem.` }] : []),
      { p: "Tick each invoice paid as the money arrives:", link: req.trackLink },
      { p: "Everything still owed, across all months:", link: `${req.trackLink}/owed` },
      { p: "These links work for 60 days. Do not forward them." },
    ],
  });
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
  /** The org's logo, prepared as for the PDF (a PNG ≤ 400 px), when the template shows it; null for initials or nothing. */
  readonly logo: Buffer | null;
  /** A one-off invoice (G2a): worded without a unit or month, copied to the customer's ccEmails. */
  readonly oneOff?: boolean;
  /** Payments recorded so far (G2b); above 0, the email asks for the balance. */
  readonly amountPaidToea?: Toea;
  /** Taken off by credit notes (G2c); above 0, likewise. */
  readonly creditedToea?: Toea;
}

/** What is still to pay: the total, less what was recorded (G2b) and credited (G2c). */
const stillToPay = (i: TenantInvoiceFacts): Toea => (i.totalToea - (i.amountPaidToea ?? 0) - (i.creditedToea ?? 0)) as Toea;

/** INV/0142 → INV-0142.pdf: a prefix can hold characters a file name cannot. */
export const pdfFilename = (number: string): string => `${number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;

const LOGO_CID = "logo";

/** The invoice's frozen template as an email's look; invoices from before templates are Classic. */
function brandOf(i: Pick<TenantInvoiceFacts, "snapshot" | "logo">): Brand {
  const t = i.snapshot.template ?? CLASSIC;
  const mark: Brand["mark"] = t.mark === "none" ? { kind: "none" }
    : t.mark === "logo" && i.logo !== null ? { kind: "logo", cid: LOGO_CID, ...size(fitInside(i.logo, 160, 60)) }
      : { kind: "monogram" };
  return { name: i.snapshot.org.name, accent: t.accent, font: t.font, mark };
}
const size = (f: { w: number; h: number }) => ({ width: Math.round(f.w), height: Math.round(f.h) });

function tenantMail(i: TenantInvoiceFacts, subject: string, opening: readonly string[]): Mail {
  const brand = brandOf(i);
  const footer = (i.snapshot.template ?? CLASSIC).footer;
  const letter: Letter = {
    greeting: `Hello ${i.snapshot.tenantName},`,
    blocks: [
      ...opening.map((p) => ({ p })),
      { rows: (i.amountPaidToea ?? 0) > 0 || (i.creditedToea ?? 0) > 0
        ? [
          ["Invoice total", formatKina(i.totalToea)],
          ...((i.amountPaidToea ?? 0) > 0 ? [["Paid so far", formatKina(i.amountPaidToea as Toea)] as const] : []),
          ...((i.creditedToea ?? 0) > 0 ? [["Credited", formatKina(i.creditedToea as Toea)] as const] : []),
          ["Still to pay", formatKina(stillToPay(i))], ["Due", dateLabel(i.dueDate)],
        ]
        : [["Amount", formatKina(i.totalToea)], ["Due", dateLabel(i.dueDate)]] },
      { rows: [["Pay to", `${i.snapshot.org.bankName}, account ${i.snapshot.org.bankAccount}`], ["Payment reference", i.paymentReference]] },
      ...(footer === "" ? [] : [{ note: footer }]),
      ...(i.snapshot.notes ? [{ note: i.snapshot.notes }] : []),
      { p: `To ask about this invoice, reply to this email to reach ${i.snapshot.org.name}.` },
    ],
  };
  const cc = i.snapshot.customer?.ccEmails ?? [];
  return {
    to: i.snapshot.tenantEmail,
    ...(cc.length === 0 ? {} : { cc }),
    fromName: i.snapshot.org.name,
    replyTo: i.snapshot.org.email,
    subject,
    text: letterText(letter),
    html: letterHtml(letter, brand, subject),
    attachments: [
      { filename: pdfFilename(i.number), content: i.pdf },
      ...(brand.mark.kind === "logo" && i.logo !== null ? [{ filename: "logo.png", content: i.logo, contentId: LOGO_CID, contentType: "image/png" }] : []),
    ],
  };
}

export function tenantInvoice(i: TenantInvoiceFacts): Mail {
  const kind = i.documentTitle === "TAX INVOICE" ? "tax invoice" : "invoice";
  if (i.oneOff === true) {
    const order = i.snapshot.poNumber ? ` for your order ${i.snapshot.poNumber}` : "";
    return tenantMail(i, tenantInvoiceSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: i.totalToea, dueDate: i.dueDate }), [
      `${i.snapshot.org.name} has sent you ${kind} ${i.number}${order}. The PDF is attached.`,
    ]);
  }
  const where = [i.snapshot.unitLabel, i.snapshot.propertyAddress].filter((s) => s !== "").join(", ");
  return tenantMail(i, tenantInvoiceSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: i.totalToea, dueDate: i.dueDate }), [
    `${i.snapshot.org.name} has sent you ${i.documentTitle === "TAX INVOICE" ? "tax invoice" : "invoice"} ${i.number} for ${where}, ${periodLabel(i.period)}. The PDF is attached.`,
  ]);
}

export function tenantReminder(i: TenantInvoiceFacts): Mail {
  const partPaid = (i.amountPaidToea ?? 0) > 0;
  if (!partPaid && (i.creditedToea ?? 0) > 0) {
    return tenantMail(i, reminderSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: stillToPay(i), dueDate: i.dueDate }), [
      `This is a reminder that invoice ${i.number} from ${i.snapshot.org.name} was due on ${dateLabel(i.dueDate)}. After the credit of ${formatKina(i.creditedToea as Toea)}, ${formatKina(stillToPay(i))} is still to pay. The PDF is attached again.`,
      "If you have already paid, thank you, and please ignore this email.",
    ]);
  }
  return tenantMail(i, reminderSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: stillToPay(i), dueDate: i.dueDate }), [
    partPaid
      ? `This is a reminder that invoice ${i.number} from ${i.snapshot.org.name} was due on ${dateLabel(i.dueDate)}. Thank you for the ${formatKina(i.amountPaidToea as Toea)} paid so far; ${formatKina(stillToPay(i))} is still to pay. The PDF is attached again.`
      : `This is a reminder that invoice ${i.number} from ${i.snapshot.org.name} was due on ${dateLabel(i.dueDate)}. The PDF is attached again.`,
    "If you have already paid, thank you, and please ignore this email.",
  ]);
}

/** What a quote's email states (G2q-a): the price, how long it holds, and the link to answer it. */
export interface QuoteFacts {
  readonly snapshot: InvoiceSnapshot;
  /** "QUO-0012", or "QUO-0012 rev 2". */
  readonly label: string;
  readonly totalToea: Toea;
  readonly validUntil: CalendarDate;
  readonly link: string;
  readonly pdf: Buffer;
  readonly logo: Buffer | null;
}

export function quoteMail(q: QuoteFacts): Mail {
  const org = q.snapshot.org;
  const subject = `Quote ${q.label} from ${org.name} - ${formatKina(q.totalToea)}, valid until ${dateLabel(q.validUntil)}`;
  const brand = brandOf(q);
  const letter: Letter = {
    greeting: `Hello ${q.snapshot.tenantName},`,
    blocks: [
      { p: `${org.name} has sent you quote ${q.label}. The PDF is attached.` },
      { rows: [["Amount", formatKina(q.totalToea)], ["Valid until", dateLabel(q.validUntil)]] },
      { p: "To accept it, or to decline it, open the quote:", link: q.link },
      ...(q.snapshot.notes ? [{ note: q.snapshot.notes }] : []),
      { p: `To ask about this quote, reply to this email to reach ${org.name}.` },
    ],
  };
  const cc = q.snapshot.customer?.ccEmails ?? [];
  return {
    to: q.snapshot.tenantEmail,
    ...(cc.length === 0 ? {} : { cc }),
    fromName: org.name,
    replyTo: org.email,
    subject,
    text: letterText(letter),
    html: letterHtml(letter, brand, subject),
    attachments: [
      { filename: pdfFilename(q.label), content: q.pdf },
      ...(brand.mark.kind === "logo" && q.logo !== null ? [{ filename: "logo.png", content: q.logo, contentId: LOGO_CID, contentType: "image/png" }] : []),
    ],
  };
}

/** What a receipt states (G2b, AR-10): what came in, and where it went. */
export interface ReceiptFacts {
  readonly to: string;
  readonly cc: readonly string[];
  readonly orgName: string;
  readonly orgEmail: string;
  /** The org's default template's look, as on its invoices. */
  readonly accent: string;
  readonly font: Brand["font"];
  readonly customerName: string;
  readonly receiptNumber: string;
  readonly receivedOn: CalendarDate;
  readonly amountToea: Toea;
  readonly method: string;
  readonly reference: string;
  readonly applied: readonly { readonly number: string; readonly amountToea: Toea; readonly balanceToea: Toea }[];
  readonly creditToea: Toea;
  /** Their credit used on these invoices as well (G2c). */
  readonly creditUsedToea?: Toea;
}

export const receiptSubject = (r: Pick<ReceiptFacts, "receiptNumber" | "orgName" | "amountToea">): string =>
  `Receipt ${r.receiptNumber} from ${r.orgName} - ${formatKina(r.amountToea)} received`;

export function receipt(r: ReceiptFacts): Mail {
  const subject = receiptSubject(r);
  const letter: Letter = {
    greeting: `Hello ${r.customerName},`,
    blocks: [
      { p: `${r.orgName} has received your payment. Thank you. This is your receipt, ${r.receiptNumber}.` },
      { rows: [
        ["Received", formatKina(r.amountToea)], ["On", dateLabel(r.receivedOn)], ["By", r.method],
        ...(r.reference === "" ? [] : [["Your reference", r.reference] as const]),
      ] },
      ...(r.applied.length === 0 ? [] : [{ rows: r.applied.map((a) => [
        `Invoice ${a.number}`,
        `${formatKina(a.amountToea)} paid${a.balanceToea === 0 ? ", now paid in full" : `, ${formatKina(a.balanceToea)} still to pay`}`,
      ] as const) }]),
      ...((r.creditUsedToea ?? 0) > 0 ? [{ p: `${formatKina(r.creditUsedToea as Toea)} of your credit was used as well.` }] : []),
      ...(r.creditToea > 0 ? [{ p: `${formatKina(r.creditToea)} was more than the invoices owed. ${r.orgName} keeps it as credit for you.` }] : []),
      { p: `To ask about this receipt, reply to this email to reach ${r.orgName}.` },
    ],
  };
  return {
    to: r.to,
    ...(r.cc.length === 0 ? {} : { cc: r.cc }),
    fromName: r.orgName,
    replyTo: r.orgEmail,
    subject,
    text: letterText(letter),
    html: letterHtml(letter, { name: r.orgName, accent: r.accent, font: r.font, mark: { kind: "monogram" } }, subject),
  };
}

/** What a credit note's email states (G2c), from the credit note as issued. */
export interface CreditNoteFacts {
  readonly snapshot: InvoiceSnapshot;
  readonly number: string;
  readonly documentTitle: string;
  readonly invoiceNumber: string;
  readonly reason: string;
  readonly totalToea: Toea;
  readonly appliedToea: Toea;
  readonly balanceAfterToea: Toea;
  readonly creditToea: Toea;
  readonly pdf: Buffer;
  readonly logo: Buffer | null;
}

export const creditNoteSubject = (c: Pick<CreditNoteFacts, "number" | "invoiceNumber" | "totalToea"> & { orgName: string }): string =>
  `Credit note ${c.number} from ${c.orgName} - ${formatKina(c.totalToea)} off invoice ${c.invoiceNumber}`;

export function creditNote(c: CreditNoteFacts): Mail {
  const org = c.snapshot.org;
  const subject = creditNoteSubject({ ...c, orgName: org.name });
  const brand = brandOf(c);
  const kind = c.documentTitle === "TAX CREDIT NOTE" ? "tax credit note" : "credit note";
  const letter: Letter = {
    greeting: `Hello ${c.snapshot.tenantName},`,
    blocks: [
      { p: `${org.name} has sent you ${kind} ${c.number} for invoice ${c.invoiceNumber}. The PDF is attached.` },
      { rows: [["Credited", formatKina(c.totalToea)], ["Reason", c.reason]] },
      { rows: [
        ...(c.appliedToea > 0 ? [[`Taken off invoice ${c.invoiceNumber}`, formatKina(c.appliedToea)] as const, [`Still to pay on ${c.invoiceNumber}`, c.balanceAfterToea === 0 ? "Nothing" : formatKina(c.balanceAfterToea)] as const] : []),
        ...(c.creditToea > 0 ? [["Kept as credit for you", formatKina(c.creditToea)] as const] : []),
      ] },
      { p: `To ask about this credit note, reply to this email to reach ${org.name}.` },
    ],
  };
  const cc = c.snapshot.customer?.ccEmails ?? [];
  return {
    to: c.snapshot.tenantEmail,
    ...(cc.length === 0 ? {} : { cc }),
    fromName: org.name,
    replyTo: org.email,
    subject,
    text: letterText(letter),
    html: letterHtml(letter, brand, subject),
    attachments: [
      { filename: pdfFilename(c.number), content: c.pdf },
      ...(brand.mark.kind === "logo" && c.logo !== null ? [{ filename: "logo.png", content: c.logo, contentId: LOGO_CID, contentType: "image/png" }] : []),
    ],
  };
}

/** An operator's invitation to sign up (PLAN-SUBSCRIBERS S3): the plan, the trial and the link. */
export function invitation(req: { to: string; planId: PlanId; trialDays: number; link: string; expiresAt: Date }): Mail {
  const plan = defaultPlan(req.planId).name;
  const offer = req.planId === "free"
    ? `Your account will be on the ${plan} plan, at no charge.`
    : `Your account starts with a ${req.trialDays}-day trial of ${plan}. Nothing to pay until it ends.`;
  return toLandlord(req.to, "You are invited to Sasimem", {
    greeting: "Hello,",
    blocks: [
      { p: "You are invited to Sasimem, which prepares your tenants' rent invoices each month, waits for your approval, sends them and reminds tenants who have not paid." },
      { p: offer },
      { p: "Sign up with this email address here:", link: req.link },
      { p: `This invitation works until ${dateLabel(localDate(req.expiresAt, SUBSCRIPTION_TIMEZONE))}.` },
    ],
  });
}

/** To Sasimem: a landlord asks to change plan (PLAN-SUBSCRIBERS §8). Replying reaches the landlord. */
export function planChangeRequest(req: {
  to: string; orgName: string; orgId: string; ownerEmail: string; current: string; wanted: string; usage: string; message: string;
}): Mail {
  const subject = `Plan change asked for: ${req.orgName}`;
  const mail = toLandlord(req.to, subject, {
    greeting: "Hello,",
    blocks: [
      { p: `${req.orgName} (${req.ownerEmail}) asks to change from ${req.current} to ${req.wanted}. They use ${req.usage}.` },
      ...(req.message === "" ? [] : [{ p: `Their message: "${req.message}"` }]),
      { p: `Their organisation ID is ${req.orgId}. Change the plan in the operator console, then reply to tell them.` },
    ],
  });
  return { ...mail, replyTo: req.ownerEmail };
}

// ---------------------------------------------------------------- the subscriber's lifecycle (PLAN-SUBSCRIBERS §9, S5)

/** Signed up: welcome, and the three steps to a first month. */
export function welcome(req: { to: string; orgName: string; appUrl: string; trialEndsOn: CalendarDate | null }): Mail {
  return toLandlord(req.to, "Welcome to Sasimem", {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: "Welcome to Sasimem. Three steps and your tenants' invoices take care of themselves:" },
      { lines: [
        "1. Add each property and its units.",
        "2. Add your tenants, and a tenancy for each: the rent, the day of the month, the payment reference.",
        "3. Each month, check the invoices Sasimem drafts and approve them with one tap. Nothing goes out until you do.",
      ] },
      { p: "Start here:", link: req.appUrl },
      ...(req.trialEndsOn === null ? [] : [{ p: `Your free trial runs until ${dateLabel(req.trialEndsOn)}.` }]),
    ],
  });
}

/** Three days in, still no tenancy: one nudge. */
export function setupNudge(req: { to: string; orgName: string; appUrl: string }): Mail {
  return toLandlord(req.to, "Add your first tenancy to start invoicing", {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: "Your Sasimem account is ready, but it has no tenancy yet, so there is nothing to invoice." },
      { p: "Adding one takes a couple of minutes: the property, the tenant, and the rent." },
      { p: "Add your first tenancy:", link: `${req.appUrl}/tenancies/new` },
      { p: "If something is in the way, reply to this email and tell us." },
    ],
  });
}

/** Trial ending, past due, restricted: the banner's words (core subscriptionNotice), by email. */
/** A subscription notice as a letter; a cancellation links straight to Export everything (S6). */
export function subscriptionLetter(req: { to: string; orgName: string; appUrl: string; title: string; body: string; cancelled?: boolean }): Mail {
  return toLandlord(req.to, req.title, {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: req.body },
      req.cancelled === true
        ? { p: "Export everything:", link: `${req.appUrl}/settings/billing#export` }
        : { p: "Your plan, payments and how to pay:", link: `${req.appUrl}/settings/billing` },
    ],
  });
}

export interface DigestLine {
  readonly orgId: string;
  readonly name: string;
  readonly detail: string;
}

export interface OperatorDigest {
  readonly signups: readonly DigestLine[];
  readonly trialsEnding: readonly DigestLine[];
  readonly pastDue: readonly DigestLine[];
  readonly restricted: readonly DigestLine[];
  readonly held: readonly DigestLine[];
  readonly bounces: readonly DigestLine[];
  /** Orgs deleted today, their issued invoices kept in the retention bucket (S6). */
  readonly purged: readonly DigestLine[];
}

const DIGEST_SECTIONS: readonly (readonly [keyof OperatorDigest, string])[] = [
  ["signups", "New sign-ups"], ["trialsEnding", "Trials ending within 7 days"], ["pastDue", "Past due"],
  ["restricted", "Restricted"], ["held", "Held runs"], ["bounces", "Emails that failed yesterday"], ["purged", "Purged today"],
];

export const digestIsEmpty = (d: OperatorDigest): boolean => DIGEST_SECTIONS.every(([k]) => d[k].length === 0);

/** To Sasimem, each morning there is something to say. */
export function operatorDigest(req: { to: string; date: CalendarDate; digest: OperatorDigest }): Mail {
  const sections = DIGEST_SECTIONS.filter(([k]) => req.digest[k].length > 0);
  return toLandlord(req.to, `Sasimem today, ${dateLabel(req.date)}`, {
    greeting: "Good morning,",
    blocks: [
      ...sections.flatMap(([k, label]) => [
        { p: `${label} (${req.digest[k].length}):` },
        { lines: req.digest[k].map((l) => `${l.name}: ${l.detail}`) },
      ]),
    ],
  });
}
