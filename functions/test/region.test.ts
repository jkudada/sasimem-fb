import { expect, test } from "vitest";
import * as functions from "../src/index.js";

test("every exported function is deployed to australia-southeast1, the nearest region to PNG", () => {
  const regions = Object.entries(functions).map(([name, fn]) => [name, (fn as { __endpoint?: { region?: string[] } }).__endpoint?.region]);
  expect(regions.length).toBeGreaterThan(0);
  for (const [name, region] of regions) expect(region, String(name)).toEqual(["australia-southeast1"]);
});
