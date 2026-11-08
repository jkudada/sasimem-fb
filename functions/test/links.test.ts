import { describe, expect, test } from "vitest";
import { checkNonce, makeNonce, newToken, tokenId } from "../src/links.js";

const key = "test-signing-key";
const t0 = new Date("2026-09-28T00:00:00Z");
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

describe("approval links", () => {
  test("a token is 32 random bytes, base64url, and is stored only as its SHA-256", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(tokenId("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("a form nonce is accepted for its own token within 30 minutes", () => {
    const nonce = makeNonce(key, "tok1", t0);
    expect(checkNonce(key, "tok1", nonce, minutes(29))).toBe(true);
  });

  test("a nonce is refused when stale, altered, for another token, or signed with another key", () => {
    const nonce = makeNonce(key, "tok1", t0);
    expect(checkNonce(key, "tok1", nonce, minutes(31))).toBe(false);
    expect(checkNonce(key, "tok2", nonce, minutes(1))).toBe(false);
    expect(checkNonce("other-key", "tok1", nonce, minutes(1))).toBe(false);
    expect(checkNonce(key, "tok1", nonce.replace(/.$/, (c) => (c === "a" ? "b" : "a")), minutes(1))).toBe(false);
    expect(checkNonce(key, "tok1", `${t0.getTime() + 60_000}.${nonce.split(".")[1]}`, minutes(1))).toBe(false);
    expect(checkNonce(key, "tok1", "garbage", minutes(1))).toBe(false);
  });
});
