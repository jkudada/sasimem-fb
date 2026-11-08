/** App Check under the emulators (plan §5). The journeys prove the app sends a token. */
import { expect, test } from "./phone.js";

test("a callable called without an App Check token is refused", async () => {
  const res = await fetch("http://127.0.0.1:5001/demo-sasimem/australia-southeast1/getNumbering", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { orgId: "any" } }),
  });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: { message: "Unauthenticated", status: "UNAUTHENTICATED" } });
});
