import { describe, expect, test } from "vitest";
import { assertScratch, compareDocs, drillDatabaseId, minutesAround, withScratch } from "../src/drill.ts";

const docs = (o: Record<string, object>) => new Map(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)]));

describe("comparing a restored database with its source", () => {
  test("every path and field equal: no differences", () => {
    const a = docs({ "orgs/o1": { name: "Wari" }, "orgs/o1/invoices/i1": { totalToea: 120000 } });
    expect(compareDocs(a, docs({ "orgs/o1": { name: "Wari" }, "orgs/o1/invoices/i1": { totalToea: 120000 } }))).toEqual({ missing: [], extra: [], changed: [] });
  });

  test("a missing, an extra and a changed document are each named", () => {
    const source = docs({ "orgs/o1": { name: "Wari" }, "orgs/o1/invoices/i1": { totalToea: 120000 }, "orgs/o1/invoices/i2": {} });
    const restored = docs({ "orgs/o1": { name: "Wari" }, "orgs/o1/invoices/i1": { totalToea: 999 }, "orgs/o2": {} });
    expect(compareDocs(source, restored)).toEqual({ missing: ["orgs/o1/invoices/i2"], extra: ["orgs/o2"], changed: ["orgs/o1/invoices/i1"] });
  });
});

describe("the scratch database", () => {
  test("is named for the kind of drill and the minute it ran", () => {
    expect(drillDatabaseId("backup", new Date("2026-11-08T03:07:59Z"))).toBe("drill-backup-20261108-0307");
    expect(drillDatabaseId("pitr", new Date("2026-11-08T03:07:59Z"))).toBe("drill-pitr-20261108-0307");
  });

  test("only a drill- database can ever be deleted by the drill", () => {
    expect(() => assertScratch("(default)")).toThrow("not a drill database");
    expect(() => assertScratch("prod")).toThrow("not a drill database");
    expect(() => assertScratch("drill-backup-20261108-0307")).not.toThrow();
  });

  test("is deleted after the comparison, and also when it fails", async () => {
    const dropped: string[] = [];
    const drop = async (id: string) => void dropped.push(id);
    expect(await withScratch("drill-a", async () => "same", drop)).toBe("same");
    await expect(withScratch("drill-b", async () => { throw new Error("differs"); }, drop)).rejects.toThrow("differs");
    expect(dropped).toEqual(["drill-a", "drill-b"]);
  });
});

describe("reading the source at a backup's snapshot time", () => {
  test("PITR older than an hour reads only whole minutes, so the minutes either side are used", () => {
    expect(minutesAround("2026-11-07T17:33:19.199825Z")).toEqual(["2026-11-07T17:33:00Z", "2026-11-07T17:34:00Z"]);
    expect(minutesAround("2026-11-07T17:33:00Z")).toEqual(["2026-11-07T17:33:00Z", "2026-11-07T17:33:00Z"]);
  });
});
