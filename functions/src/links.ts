/**
 * The approval link's credentials (plan §6.1). Holding the link is the login, so:
 * the token is 32 random bytes; the database keeps only its SHA-256, so an export
 * holds no working links; and every form POST carries a nonce signed with
 * APPROVAL_SIGNING_KEY that names its token and expires after 30 minutes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const newToken = (): string => randomBytes(32).toString("base64url");

export const tokenId = (token: string): string => createHash("sha256").update(token).digest("hex");

const NONCE_LIFE_MS = 30 * 60_000;
const sign = (key: string, token: string, issued: number) => createHmac("sha256", key).update(`${token}|${issued}`).digest("base64url");

export const makeNonce = (key: string, token: string, now: Date): string => `${now.getTime()}.${sign(key, token, now.getTime())}`;

export function checkNonce(key: string, token: string, nonce: string, now: Date): boolean {
  const [issuedText, mac] = nonce.split(".");
  const issued = Number(issuedText);
  if (!Number.isSafeInteger(issued) || mac === undefined) return false;
  const age = now.getTime() - issued;
  if (age < 0 || age > NONCE_LIFE_MS) return false;
  const expected = Buffer.from(sign(key, token, issued));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
