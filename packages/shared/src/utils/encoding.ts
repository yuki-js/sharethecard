/**
 * Encoding and Crypto helpers (shared)
 *
 * Purpose:
 * - Centralize base64/UTF-8 conversions
 * - Provide Ed25519 import/export helpers
 * - Reduce duplicated logic across packages
 * - Prepare signing payloads consistently
 *
 * Note:
 * - Uses globalThis.crypto to be environment-independent (Node >=15, Browsers)
 * - Avoids direct node:crypto imports
 */

const crypto = globalThis.crypto as Crypto;

/**
 * Base64 encode helper (browser-first, Node fallback).
 * Returns a standard base64 string.
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
  // btoa may not exist in some non-browser runtimes; in such cases, prefer Buffer above.
  return typeof btoa === "function" ? btoa(binary) : binary;
}

/**
 * Base64 decode helper (browser-first, Node fallback).
 * Accepts a standard base64 string and returns bytes.
 */
export function fromBase64(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const BufferCtor = (globalThis as any).Buffer;
  if (BufferCtor) {
    return new Uint8Array(BufferCtor.from(base64, "base64"));
  }
  // Fallback: decode manually if no Buffer (unlikely)
  const binary = typeof atob === "function" ? atob(base64) : "";
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * UTF-8 encode helper.
 * Converts a string to bytes.
 */
export function toUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

import { canonicalizeJson } from "./canonical-json.js";

/**
 * Prepare signing payload consistently using canonical JSON.
 * Ensures deterministic bytes for signing/verification.
 */
export function prepareSigningPayload(data: unknown): Uint8Array {
  return canonicalizeJson(data);
}



/**
 * TODO: Replace with RFC 4122 UUID v5 / v4 generation
 *
 * Current implementation converts a SHA-256 hash to base64url.
 * This helper exists to centralize the pattern while we transition
 * to proper RFC 4122 UUIDs.
 *
 * References:
 * - RFC 4122 UUID v4: random-based
 * - RFC 4122 UUID v5: name-based (deterministic, SHA-1)
 *   https://www.rfc-editor.org/rfc/rfc4122
 */
export async function hashToBase64Url(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    data.buffer as ArrayBuffer,
  );
  const base64 = toBase64(new Uint8Array(hashBuffer));
  // Temporary base64url conversion; to be replaced by RFC UUID.
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * TODO: Replace with RFC 4122 UUID derivation (e.g., UUID v5 for deterministic IDs)
 *
 * Derives a temporary peer ID in the form "peer_<base64url>" from the
 * SHA-256 hash of the public key. This should be replaced with an RFC-compliant
 * UUID generation strategy to avoid base64url in IDs.
 */
export async function deriveIdFromPublicKeyHash(
  publicKeyBase64: string,
): Promise<string> {
  const publicKeyBytes = fromBase64(publicKeyBase64);
  const base64url = await hashToBase64Url(publicKeyBytes);
  return `peer_${base64url}`;
}