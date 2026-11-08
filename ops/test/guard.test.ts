import { describe, expect, test } from "vitest";
import { projectFrom } from "../src/guard.ts";

describe("every ops script names its project, and leaves production to its owner", () => {
  test("the project comes from --project", () => {
    expect(projectFrom(["--project", "sasimem-dev"])).toBe("sasimem-dev");
    expect(projectFrom(["--email", "a@b.example", "--project=sasimem-dev"])).toBe("sasimem-dev");
  });

  test("with no --project, nothing runs: there is no default project", () => {
    expect(() => projectFrom([])).toThrow("--project");
  });

  test("sasimem-prod needs --i-am-the-owner", () => {
    expect(() => projectFrom(["--project", "sasimem-prod"])).toThrow("--i-am-the-owner");
    expect(projectFrom(["--project", "sasimem-prod", "--i-am-the-owner"])).toBe("sasimem-prod");
  });

  test("a demo- project or a malformed ID is refused", () => {
    expect(() => projectFrom(["--project", "demo-sasimem"])).toThrow("emulator");
    expect(() => projectFrom(["--project", "Sasimem Dev"])).toThrow("project ID");
  });
});
