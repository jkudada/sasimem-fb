// T1 web setup. The first render in a happy-dom worker costs 50-70 ms of one-off
// warm-up (Preact, Testing Library, the DOM). Pay it once per file here, so the
// 100 ms T1 alarm measures tests, not warm-up.
import { cleanup, configure, render } from "@testing-library/preact";
import { afterEach, beforeAll } from "vitest";

// Role queries spend most of their time computing styles to decide visibility,
// which is slow in happy-dom. These screens hide nothing, so skip that check;
// accessible names and roles are still enforced.
configure({ defaultHidden: true });

beforeAll(() => {
  render(<p>warm-up</p>);
  cleanup();
});
afterEach(cleanup);
