/** The emails step 4 sends (plan §6.6). Plain text; the landlord's words, not the system's. */
import { type Period, type Toea, digestSubject, formatKina, periodLabel } from "@sasimem/core";
import type { Mail } from "./mailer.js";

/** "8:00 am, Thursday 1 October 2026", in the landlord's time. */
export function whenLabel(at: Date, timezone: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: timezone, ...o }).format(at);
  return `${f({ hour: "numeric", minute: "2-digit", hour12: true })}, ${f({ weekday: "long" })} ${f({ day: "numeric", month: "long", year: "numeric" })}`;
}

const WARNING = "This link works for 7 days. Do not forward it: anyone who has it can approve these invoices.";

export function approvalDigest(req: { to: string; orgName: string; period: Period; count: number; totalToea: Toea; link: string; sendAt: Date; timezone: string }): Mail {
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
      `Nothing goes to your tenants until you approve. Approved invoices go out at ${whenLabel(req.sendAt, req.timezone)}. If you have not approved by then, they are held, not sent.`,
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
