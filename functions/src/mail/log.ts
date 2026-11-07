/**
 * The email log (plan §4 emails, §6.6). Every message the server sends goes through
 * sendLogged, which records it under orgs/{orgId}/emails: kind, recipient, subject,
 * run, invoice, the provider's message ID, time and status. Never the body - an
 * approval email's body holds a working link.
 */
import type { Period } from "@sasimem/core";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import type { Mail, Mailer } from "./mailer.js";

export type EmailKind = "approvalDigest" | "freshLink" | "held" | "dispatch" | "tenantInvoice" | "reminder";

export interface MailContext {
  readonly orgId: string;
  readonly kind: EmailKind;
  readonly runPeriod?: Period;
  readonly invoiceId?: string;
}

/** A landlord may ask for fresh links again and again; every other kind goes once per run or invoice. */
const sentOnce = (kind: EmailKind) => kind !== "freshLink";

export async function sendLogged(deps: { readonly mailer: Mailer; readonly now: Date }, ctx: MailContext, mail: Mail): Promise<string> {
  const key = sentOnce(ctx.kind) ? `${ctx.orgId}/${ctx.kind}/${ctx.invoiceId ?? ctx.runPeriod ?? ""}` : undefined;
  const entry = {
    kind: ctx.kind, to: mail.to, subject: mail.subject,
    runPeriod: ctx.runPeriod ?? null, invoiceId: ctx.invoiceId ?? null,
    sentAt: Timestamp.fromDate(deps.now),
  };
  const log = db().collection(`orgs/${ctx.orgId}/emails`);
  let id: string;
  try {
    ({ id } = await deps.mailer.send(key === undefined ? mail : { ...mail, idempotencyKey: key }));
  } catch (e) {
    await log.add({ ...entry, providerMessageId: null, status: "failed", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  await log.add({ ...entry, providerMessageId: id, status: "sent", error: null });
  return id;
}
