// T1 web setup. The first render in a happy-dom worker costs 50-70 ms of one-off
// warm-up (Preact, Testing Library, the DOM). Pay it once per file here, so the
// 100 ms T1 alarm measures tests, not warm-up.
import { cleanup, render } from "@testing-library/preact";
import { afterEach, beforeAll } from "vitest";

beforeAll(() => {
  render(<p>warm-up</p>);
  cleanup();
});
afterEach(cleanup);
