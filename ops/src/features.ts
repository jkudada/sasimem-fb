/**
 * Switching an org's features (docs/PLAN-GENERAL-INVOICING.md §3, G2a). `features` is
 * server-written: until G5's pricing, an operator sets it with ops/features.ts. The whole
 * map is written, because once `features` exists core reads only it: writing
 * { oneOff: true } alone would switch Rentals off. Copied from core (ops cannot import
 * it); test/features.test.ts proves the copy equal.
 */
import { documentsRoot, type Write } from "./subscribers.ts";

export const OPS_FEATURES = ["rentals", "repeating", "oneOff", "quotes", "tradeJobs"] as const;
export type OpsFeature = (typeof OPS_FEATURES)[number];

/** What a Rentals org has with nothing stored. */
export const RENTALS_TODAY: readonly OpsFeature[] = ["rentals", "repeating"];

/** "rentals,repeating,oneOff" → the full map; an unknown name is refused, naming the known ones. */
export function featureMap(list: string): Record<OpsFeature, boolean> {
  const named = list.split(",").map((f) => f.trim()).filter((f) => f !== "");
  const unknown = named.filter((f) => !(OPS_FEATURES as readonly string[]).includes(f));
  if (unknown.length > 0) throw new Error(`Unknown feature ${unknown.join(", ")}. Known: ${OPS_FEATURES.join(", ")}.`);
  if (named.length === 0) throw new Error(`Name the features to have on: --on ${RENTALS_TODAY.join(",")},oneOff`);
  return Object.fromEntries(OPS_FEATURES.map((f) => [f, named.includes(f)])) as Record<OpsFeature, boolean>;
}

const ORG_ID = /^[A-Za-z0-9]{1,64}$/;

/** Set orgs/{orgId}.features to exactly this map; the org must exist, and nothing else on it changes. */
export function featuresWrite(project: string, orgId: string, features: Readonly<Record<OpsFeature, boolean>>): Write {
  if (!ORG_ID.test(orgId)) throw new Error(`"${orgId}" is not an org ID.`);
  return {
    update: {
      name: `${documentsRoot(project)}/orgs/${orgId}`,
      fields: { features: { mapValue: { fields: Object.fromEntries(OPS_FEATURES.map((f) => [f, { booleanValue: features[f] }])) } } },
    },
    updateMask: { fieldPaths: ["features"] },
    currentDocument: { exists: true },
  };
}
