/**
 * The retention bucket (PLAN-SUBSCRIBERS §11, D12; S6): when an org is purged, its issued
 * invoices and their PDFs are copied here and kept 7 years, then deleted by the bucket's
 * own lifecycle rule. No client can reach it: uniform access, public access prevented,
 * and no Firebase rules (it is not a Firebase bucket). The functions write to it as the
 * default compute service account, whose project role already covers the project's buckets.
 */

/** 7 years of 365 days plus the leap days they can hold. */
export const RETENTION_DAYS = 7 * 365 + 2;
/** Where the functions run (functions/src/options.ts). */
export const RETENTION_LOCATION = "AUSTRALIA-SOUTHEAST1";

export const retentionBucketName = (project: string): string => `${project}-retention`;

export interface BucketSpec {
  name: string;
  location: string;
  storageClass: string;
  iamConfiguration: { uniformBucketLevelAccess: { enabled: boolean }; publicAccessPrevention: string };
  lifecycle: { rule: { action: { type: string }; condition: { age: number } }[] };
  labels: Record<string, string>;
}

/**
 * Archive class: written once, read only if Sasimem is asked for an old invoice. Its
 * 365-day minimum is far inside the 7 years every object stays.
 */
export function retentionBucketSpec(project: string): BucketSpec {
  return {
    name: retentionBucketName(project),
    location: RETENTION_LOCATION,
    storageClass: "ARCHIVE",
    iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" },
    lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: RETENTION_DAYS } }] },
    labels: { app: "sasimem", purpose: "retention" },
  };
}

/** What an existing bucket is brought back to: everything but its name, place and class, which cannot change. */
export function retentionBucketPatch(project: string): Pick<BucketSpec, "iamConfiguration" | "lifecycle" | "labels"> {
  const { iamConfiguration, lifecycle, labels } = retentionBucketSpec(project);
  return { iamConfiguration, lifecycle, labels };
}
