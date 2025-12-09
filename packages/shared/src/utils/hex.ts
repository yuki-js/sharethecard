/**
 * Hex utilities
 *
 * Provides safe, reusable helpers for parsing and validating hex strings.
 * Used by Controller CLI commands to avoid duplicated logic.
 */

/**
 * Remove whitespace and normalize the hex string.
 */
export function cleanHex(input: string): string {
  return input.replace(/\s+/g, '');
}

/**
 * Validate that a string contains only hex characters and has even length.
 */
export function isValidEvenHex(hex: string): boolean {
  return /^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0;
}

/**
 * Parse a hex string (whitespace allowed) into bytes.
 * Throws on invalid format.
 */
export function parseHexToBytes(input: string): Uint8Array<ArrayBuffer> {
  const hex = cleanHex(input);
  if (!isValidEvenHex(hex)) {
    throw new Error('Invalid hex format (must be even-length hex)');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out as unknown as Uint8Array<ArrayBuffer>;
}

/**
 * Parse APDU hex string into bytes with stricter validation.
 * Enforces at least 4 header bytes (8 hex chars).
 */
export function parseApduHex(input: string): Uint8Array<ArrayBuffer> {
  const hex = cleanHex(input);
  if (!isValidEvenHex(hex) || hex.length < 8) {
    throw new Error('Invalid APDU hex format (even-length hex, at least 4 bytes required)');
  }
  return parseHexToBytes(hex);
}