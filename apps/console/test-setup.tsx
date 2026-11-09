// T1 web setup. The first render in a happy-dom worker costs 50-70 ms of one-off
// warm-up (Preact, Testing Library, the DOM). Pay it once per file here, so the
// 100 ms T1 alarm measures tests, not warm-up.
import { cleanup, configure, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeAll } from "vitest";

// Role queries spend most of their time computing styles to decide visibility,
// which is slow in happy-dom. These screens hide nothing, so skip that check;
// accessible names and roles are still enforced.
configure({ defaultHidden: true });

// Exercise the paths a form test uses (label and role queries, input and click
// events, an async find), not just a render: a bare <p> left ~40 ms of first-use
// cost on the first form test in each file.
beforeAll(async () => {
  render(
    <form onSubmit={(e) => e.preventDefault()}>
      <label>Warm-up<input /></label>
      <button type="submit">Go</button>
      <p role="alert">ready</p>
      <a href="/x">link</a>
    </form>,
  );
  fireEvent.input(screen.getByLabelText(/warm-up/i), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  await screen.findByRole("alert");
  screen.getByRole("link", { name: /link/i });
  cleanup();
});
afterEach(cleanup);
