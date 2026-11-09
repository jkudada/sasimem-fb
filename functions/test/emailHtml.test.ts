/**
 * Branded HTML email (docs/PLAN-TEMPLATES.md §6): every email's HTML says what its text
 * says; tenants' wear the invoice's frozen template, landlords' the house style.
 */
import { type CalendarDate, CLASSIC, type InvoiceSnapshot, type InvoiceTemplate, type Period, type Toea } from "@sasimem/core";
import sharp from "sharp";
import { beforeAll, describe, expect, test } from "vitest";
import type { Mail } from "../src/mail/mailer.js";
import {
  type TenantInvoiceFacts, approvalDigest, dispatchNotice, freshLink, freshTrackingLink, heldNotice, tenantInvoice, tenantReminder,
} from "../src/mail/templates.js";
import { prepareLogo } from "../src/pdf.js";

const OCT = "2026-10" as Period;
const band: InvoiceTemplate = { name: "Shops", layout: "band", accent: "#1f4e8c", font: "times", mark: "logo", footer: "Thank you.\nRent is due on the 1st." };
const snapshot = (over: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot => ({
  org: { name: "Wari Holdings", address: "Boroko", email: "mary@wari.example", logoPath: "logos/o/1.png", gstRegistered: false, gstNumber: "", bankName: "BSP", bankAccount: "1000 2345" },
  tenantName: "Peter Kila", tenantEmail: "peter@kila.example", unitLabel: "Flat 1", propertyAddress: "Lot 4, Boroko", template: band, ...over,
});
let logo: Buffer;
beforeAll(async () => {
  logo = await prepareLogo(await sharp({ create: { width: 400, height: 400, channels: 4, background: "#1f4e8c" } }).png().toBuffer());
});
const facts = (over: Partial<TenantInvoiceFacts> = {}): TenantInvoiceFacts => ({
  snapshot: snapshot(), number: "INV-0001", documentTitle: "INVOICE", period: OCT, totalToea: 120_000 as Toea,
  dueDate: "2026-10-08" as CalendarDate, paymentReference: "KILA-OCT26", pdf: Buffer.from("%PDF-1.3 tiny"), logo, ...over,
});
const sendAt = new Date("2026-09-30T22:00:00Z");
const tz = "Pacific/Port_Moresby";
const link = "https://sasimem.example/a/tok-123";

/** Every kind of email, as sent. */
const ALL = (): Record<string, Mail> => ({
  approvalDigest: approvalDigest({ to: "mary@wari.example", orgName: "Wari Holdings", period: OCT, count: 2, totalToea: 210_000 as Toea, link, sendAt, timezone: tz }),
  freshLink: freshLink({ to: "mary@wari.example", orgName: "Wari Holdings", period: OCT, link }),
  freshTrackingLink: freshTrackingLink({ to: "mary@wari.example", orgName: "Wari Holdings", period: OCT, link }),
  held: heldNotice({ to: "mary@wari.example", orgName: "Wari Holdings", period: OCT, link, sendAt, timezone: tz }),
  dispatch: dispatchNotice({ to: "mary@wari.example", orgName: "Wari Holdings", period: OCT, trackLink: link, lines: [
    { tenantName: "Peter Kila", number: "INV-0001", totalToea: 120_000 as Toea, sent: true },
    { tenantName: "Mary Wari", number: "INV-0002", totalToea: 90_000 as Toea, sent: false },
  ] }),
  tenantInvoice: tenantInvoice(facts()),
  reminder: tenantReminder(facts()),
});

/** What a reader of the HTML sees: the body's text, entities decoded, spacing and colons ignored. */
const seen = (html: string): string => html
  .replace(/<head>[\s\S]*<\/head>/, "").replace(/<br>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  .replace(/:/g, "").replace(/\s+/g, " ").trim();
const said = (text: string): string => text.replace(/:/g, "").replace(/\s+/g, " ").trim();

describe("every email's HTML", () => {
  test("says what its text says, after the sender's name (golden per kind)", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    for (const [kind, mail] of Object.entries(ALL())) {
      const html = mail.html ?? "";
      expect(seen(html), kind).toMatch(new RegExp(`^(Sasimem|WH Wari Holdings|Wari Holdings) ${said(mail.text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
      const golden = new URL(`./golden/email-${kind}.html`, import.meta.url);
      if (process.env["WRITE_GOLDEN"] === "1") writeFileSync(golden, html);
      expect(html, kind).toBe(readFileSync(golden, "utf8"));
    }
  });

  test("has no remote images, scripts or tracking, and stays within 20 KB before the logo", () => {
    for (const [kind, mail] of Object.entries(ALL())) {
      const html = mail.html ?? "";
      expect(html, kind).not.toMatch(/<img[^>]+src="(?!cid:)/);
      expect(html, kind).not.toMatch(/<script|<link|url\(|<iframe|<form/i);
      expect(Buffer.byteLength(html), kind).toBeLessThanOrEqual(20 * 1024);
    }
  });

  test("shows every link as its own visible URL, in both parts", () => {
    const m = ALL();
    for (const kind of ["approvalDigest", "freshLink", "held", "freshTrackingLink", "dispatch"]) {
      expect(m[kind]?.text, kind).toContain(link);
      expect(m[kind]?.html, kind).toContain(`<a href="${link}" style="color:#0d6b4f;word-break:break-all">${link}</a>`);
    }
  });
});

describe("a tenant's email wears the invoice's frozen template", () => {
  test("the accent, the font, the logo inline by content ID, and the note - in the reminder too", () => {
    for (const mail of [tenantInvoice(facts()), tenantReminder(facts())]) {
      const html = mail.html ?? "";
      expect(html).toContain("border-top:6px solid #1f4e8c");
      expect(html).toContain("font-family:Georgia,'Times New Roman',Times,serif");
      expect(html).toMatch(/<img src="cid:logo" width="60" height="60" alt="Wari Holdings"/);
      expect(html).toContain("Thank you.<br>Rent is due on the 1st.");
      expect(mail.text).toContain("Thank you.\nRent is due on the 1st.");
      expect(mail.attachments?.map((a) => [a.filename, a.contentId ?? null])).toEqual([["INV-0001.pdf", null], ["logo.png", "logo"]]);
      expect(mail.attachments?.[1]?.content.equals(logo)).toBe(true);
    }
  });

  test("initials when the template shows them or there is no logo; nothing when it shows nothing; Classic before templates", () => {
    const initials = tenantInvoice(facts({ logo: null }));
    expect(initials.html).toMatch(/background:#1f4e8c;color:#ffffff;font-weight:bold;font-size:18px">WH</);
    expect(initials.attachments).toHaveLength(1);
    const none = tenantInvoice(facts({ snapshot: snapshot({ template: { ...band, mark: "none" } }), logo: null }));
    expect(none.html).not.toContain(">WH<");
    const { template: _, ...before } = snapshot();
    const classic = tenantInvoice(facts({ snapshot: before, logo: null }));
    expect(classic.html).toContain(`border-top:6px solid ${CLASSIC.accent}`);
    expect(classic.text).not.toContain("Thank you.");
  });

  test("names with markup, ampersands and quotes are escaped in the HTML, and kept as typed in the text", () => {
    const evil = `<script>alert("x")</script> & 'Co'`;
    const mail = tenantInvoice(facts({ snapshot: snapshot({ tenantName: evil, propertyAddress: evil, org: { ...snapshot().org, name: evil }, template: { ...band, footer: evil } }) }));
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain(`"x"`);
    expect(mail.html).toContain("&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; &#39;Co&#39;");
    expect(mail.text).toContain(evil);
  });
});

test("landlord emails use the house style, whatever the invoices look like", () => {
  for (const kind of ["approvalDigest", "freshLink", "freshTrackingLink", "held", "dispatch"]) {
    const html = ALL()[kind]?.html ?? "";
    expect(html, kind).toContain("border-top:6px solid #0d6b4f");
    expect(html, kind).toMatch(/font-size:20px;font-weight:bold;color:#0d6b4f">Sasimem</);
    expect(html, kind).not.toContain("cid:");
  }
});

describe("sending a tenant's invoice (T3)", () => {
  test("the org's stored logo goes inline when the frozen template shows it; a lost logo gives initials and the email still goes", async () => {
    const { parsePeriod } = await import("@sasimem/core");
    const { bucket } = await import("../src/admin.js");
    const { sendTenantInvoice } = await import("../src/notify.js");
    const { approveRun } = await import("../src/store/approval.js");
    const { renderMissingPdfs } = await import("../src/store/pdfs.js");
    const { draftRun } = await import("../src/store/runs.js");
    const { adminDb } = await import("./harness/index.js");
    const { FakeMailer } = await import("./harness/mailer.js");
    const { anOrgWith } = await import("./harness/seed.js");

    const { orgId } = await anOrgWith({ tenancies: [{ id: "k1" }] });
    const raw = await sharp({ create: { width: 800, height: 300, channels: 4, background: "#a3312a" } }).png().toBuffer();
    await bucket().file(`logos/${orgId}/1.png`).save(raw, { contentType: "image/png" });
    await adminDb().doc(`orgs/${orgId}/templates/t1`).set(band);
    await adminDb().doc(`orgs/${orgId}`).update({ logoPath: `logos/${orgId}/1.png`, defaultTemplateId: "t1" });
    const OCTP = parsePeriod("2026-10");
    const now = new Date("2026-09-28T00:00:00Z");
    await draftRun(orgId, OCTP, now);
    await approveRun(orgId, OCTP, { actor: "uid", now });
    await renderMissingPdfs(orgId, OCTP);

    const mailer = new FakeMailer();
    const deps = { now: () => now, mailer, newToken: () => "t", appUrl: () => "https://sasimem.example" };
    const invoice = async () => (await adminDb().doc(`orgs/${orgId}/invoices/k1_2026-10`).get()).data() as never;
    await sendTenantInvoice(deps, orgId, "k1_2026-10", await invoice());
    const [mail] = mailer.sent;
    const inline = mail?.attachments?.find((a) => a.contentId === "logo");
    expect(inline?.contentType).toBe("image/png");
    expect(inline?.content.readUInt32BE(16)).toBe(400); // prepared as for the PDF: ≤ 400 px
    expect(mail?.html).toMatch(/<img src="cid:logo" width="160" height="60"/);

    await bucket().file(`logos/${orgId}/1.png`).delete();
    const { sendInvoiceAgain } = await import("../src/notify.js");
    await sendInvoiceAgain(deps, orgId, "k1_2026-10", await invoice());
    expect(mailer.sent[1]?.attachments?.map((a) => a.filename)).toEqual(["INV-0001.pdf"]);
    expect(mailer.sent[1]?.html).toContain(">WH<");
  });
});
