/**
 * The template preview (docs/PLAN-TEMPLATES.md §4): the real PDF renderer, run on a
 * sample invoice with the org's details and the settings being edited. Android
 * Chrome cannot show a PDF inline, so the app saves it and the phone opens it.
 * Nothing is stored. Owner only; App Check is enforced for every callable (options.ts).
 */
import { type InvoiceTemplate, localDate, sampleInvoice, templateProblems } from "@sasimem/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { bucket } from "../admin.js";
import { renderInvoicePdf } from "../pdf.js";
import { type OrgDoc, refs } from "../store/runs.js";
import { ownerOrg } from "./auth.js";

const FIELDS = ["name", "layout", "accent", "font", "mark", "footer"] as const;

/** The template the app sent, checked as the rules check a saved one. */
export function readTemplate(data: unknown): InvoiceTemplate {
  const t = (data as { template?: unknown } | null)?.template;
  if (typeof t !== "object" || t === null || !FIELDS.every((f) => typeof (t as Record<string, unknown>)[f] === "string")) {
    throw new HttpsError("invalid-argument", "That template could not be read. Reload and try again.");
  }
  const raw = t as Record<(typeof FIELDS)[number], string>;
  const template = Object.fromEntries(FIELDS.map((f) => [f, raw[f]])) as unknown as InvoiceTemplate;
  const first = Object.values(templateProblems(template))[0];
  if (first !== undefined) throw new HttpsError("invalid-argument", first);
  return template;
}

export function makeTemplateCallables(deps: { now: () => Date }) {
  return {
    // A handful of instances: one landlord previews a few times while choosing.
    previewInvoicePdf: onCall<unknown, Promise<{ filename: string; base64: string }>>({ maxInstances: 5 }, async (request) => {
      const orgId = await ownerOrg(request);
      const template = readTemplate(request.data);
      const org = (await refs(orgId).org.get()).data() as OrgDoc;
      const logo = template.mark === "logo" && org.logoPath !== undefined
        ? await bucket().file(org.logoPath).download().then(([b]) => b, () => null) // a lost logo previews as initials, as it would print
        : null;
      const pdf = await renderInvoicePdf(sampleInvoice(org, template, localDate(deps.now(), org.timezone)), logo);
      return { filename: "sample-invoice.pdf", base64: pdf.toString("base64") };
    }),
  };
}
