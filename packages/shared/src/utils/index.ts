/**
 * Shared utility functions for Remote APDU System
 */

/**
 * WebCrypto: use global in both Node.js (>=15) and Browsers
 */
const crypto = globalThis.crypto;

/**
 * Base64 encode helper (browser-first, Node fallback)
 */
export function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  const BufferCtor = (globalThis as any).Buffer;
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString("base64");
  }
  // Fallback: encode manually if no Buffer (unlikely)
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Generate a UUID v4 (128-bit)
 * Used for Cardhost identification
 */
export function generateUuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // RFC 4122 v4 variant
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * Validate UUID format
 */
export function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    uuid,
  );
}

/**
 * Generate cryptographically secure random base64 string
 */
export function generateRandomBase64(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toBase64(buffer);
}

/**
 * Re-exports: canonical JSON, hex utilities, and logger
 */
export * from "./canonical-json.js";
export * from "./hex.js";
export * from "./logger.js";
