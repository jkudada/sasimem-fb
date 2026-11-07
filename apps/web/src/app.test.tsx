import { render, screen } from "@testing-library/preact";
import { expect, test } from "vitest";
import { App } from "./app.js";

test("the app shell names the product", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sasimem");
});
