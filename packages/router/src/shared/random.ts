/**
 * Router-local random helpers
 * Moved from @remote-apdu/shared to keep shared package limited to multi-package utilities.
 */

const crypto = globalThis.crypto;
import { toBase64 } from "@remote-apdu/shared";

/**
 * Generate cryptographically secure random base64 string
 */
export function generateRandomBase64(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toBase64(buffer);
}