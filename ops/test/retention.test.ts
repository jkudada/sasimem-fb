import { describe, expect, test } from "vitest";
import { RETENTION_DAYS, retentionBucketPatch, retentionBucketSpec } from "../src/retention.ts";

describe("the retention bucket (PLAN-SUBSCRIBERS §11, D12)", () => {
  test("is the project's own, in the functions' region, closed to the public and to per-object grants", () => {
    const b = retentionBucketSpec("sasimem-dev");
    expect(b.name).toBe("sasimem-dev-retention");
    expect(b.location).toBe("AUSTRALIA-SOUTHEAST1");
    expect(b.iamConfiguration).toEqual({ uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" });
    expect(b.labels).toEqual({ app: "sasimem", purpose: "retention" });
  });

  test("deletes each copy 7 years after it was made, and not before", () => {
    expect(RETENTION_DAYS).toBe(2557);
    expect(retentionBucketSpec("sasimem-dev").lifecycle).toEqual({ rule: [{ action: { type: "Delete" }, condition: { age: 2557 } }] });
  });

  test("rerun on an existing bucket, it restores the access and lifecycle settings only", () => {
    expect(Object.keys(retentionBucketPatch("sasimem-dev")).sort()).toEqual(["iamConfiguration", "labels", "lifecycle"]);
  });
});
