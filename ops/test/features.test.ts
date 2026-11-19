import { FEATURES, orgFeatures } from "@sasimem/core";
import { describe, expect, test } from "vitest";
import { OPS_FEATURES, RENTALS_TODAY, featureMap, featuresWrite } from "../src/features.ts";

describe("the ops copy matches core's (ops scripts cannot import core)", () => {
  test("the same features", () => {
    expect(OPS_FEATURES).toEqual(FEATURES);
  });

  test("what a Rentals org has with nothing stored", () => {
    const today = orgFeatures({});
    expect(RENTALS_TODAY).toEqual(OPS_FEATURES.filter((f) => today[f]));
  });
});

describe("the features map", () => {
  test("names every feature: those listed on, the rest off; core reads it back the same", () => {
    const map = featureMap("rentals, repeating,oneOff");
    expect(map).toEqual({ rentals: true, repeating: true, oneOff: true, quotes: false, tradeJobs: false });
    expect(orgFeatures({ features: map })).toEqual(map);
  });

  test("an unknown feature or an empty list is refused", () => {
    expect(() => featureMap("rentals,oneoff")).toThrow("Unknown feature oneoff");
    expect(() => featureMap("")).toThrow("Name the features");
  });
});

describe("the write", () => {
  test("only the features field, on an org that exists", () => {
    const w = featuresWrite("sasimem-dev", "org1", featureMap("rentals,repeating,oneOff"));
    expect(w.updateMask).toEqual({ fieldPaths: ["features"] });
    expect(w.currentDocument).toEqual({ exists: true });
    expect(w.update.name).toBe("projects/sasimem-dev/databases/(default)/documents/orgs/org1");
    expect(w.update.fields["features"]).toEqual({ mapValue: { fields: {
      rentals: { booleanValue: true }, repeating: { booleanValue: true }, oneOff: { booleanValue: true },
      quotes: { booleanValue: false }, tradeJobs: { booleanValue: false },
    } } });
  });

  test("an org ID that is not one is refused (no path tricks)", () => {
    expect(() => featuresWrite("sasimem-dev", "../sasimem/billing", featureMap("rentals"))).toThrow("not an org ID");
    expect(() => featuresWrite("sasimem-dev", "", featureMap("rentals"))).toThrow("not an org ID");
  });
});
