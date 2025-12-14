/**
 * Shared utility functions for Remote APDU System
 */


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
 * Re-exports: canonical JSON, hex utilities, and logger
 */
export * from "./canonical-json.js";
export * from "./logger.js";
export * from "./encoding.js";
