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
}

/** INV/0142 → INV-0142.pdf: a prefix can hold characters a file name cannot. */
export const pdfFilename = (number: string): string => `${number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;

const LOGO_CID = "logo";

/** The invoice's frozen template as an email's look; invoices from before templates are Classic. */
function brandOf(i: TenantInvoiceFacts): Brand {
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
      { rows: [["Amount", formatKina(i.totalToea)], ["Due", dateLabel(i.dueDate)]] },
      { rows: [["Pay to", `${i.snapshot.org.bankName}, account ${i.snapshot.org.bankAccount}`], ["Payment reference", i.paymentReference]] },
      ...(footer === "" ? [] : [{ note: footer }]),
      { p: `To ask about this invoice, reply to this email to reach ${i.snapshot.org.name}.` },
    ],
  };
  return {
    to: i.snapshot.tenantEmail,
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
  const where = [i.snapshot.unitLabel, i.snapshot.propertyAddress].filter((s) => s !== "").join(", ");
  return tenantMail(i, tenantInvoiceSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: i.totalToea, dueDate: i.dueDate }), [
    `${i.snapshot.org.name} has sent you ${i.documentTitle === "TAX INVOICE" ? "tax invoice" : "invoice"} ${i.number} for ${where}, ${periodLabel(i.period)}. The PDF is attached.`,
  ]);
}

export function tenantReminder(i: TenantInvoiceFacts): Mail {
  return tenantMail(i, reminderSubject({ number: i.number, orgName: i.snapshot.org.name, totalToea: i.totalToea, dueDate: i.dueDate }), [
    `This is a reminder that invoice ${i.number} from ${i.snapshot.org.name} was due on ${dateLabel(i.dueDate)}. The PDF is attached again.`,
    "If you have already paid, thank you, and please ignore this email.",
  ]);
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
export function subscriptionLetter(req: { to: string; orgName: string; appUrl: string; title: string; body: string }): Mail {
  return toLandlord(req.to, req.title, {
    greeting: `Hello ${req.orgName},`,
    blocks: [
      { p: req.body },
      { p: "Your plan, payments and how to pay:", link: `${req.appUrl}/settings/billing` },
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
}

const DIGEST_SECTIONS: readonly (readonly [keyof OperatorDigest, string])[] = [
  ["signups", "New sign-ups"], ["trialsEnding", "Trials ending within 7 days"], ["pastDue", "Past due"],
  ["restricted", "Restricted"], ["held", "Held runs"], ["bounces", "Emails that failed yesterday"],
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
