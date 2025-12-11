/**
 * Authentication Utilities for Cardhost
 * Handles cryptographic operations for WebSocket-based authentication
 *
 * これらのユーティリティは router-transport.ts で使用される
 */

const crypto = globalThis.crypto;
import { canonicalizeJson, createLogger } from "../../../shared/src/index.js";

const logger = createLogger("cardhost:auth-utils");

function toBase64(bytes: Uint8Array): string {
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

function fromBase64(base64: string): Uint8Array {
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
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verify that Router-derived UUID matches public key hash
 * This prevents man-in-the-middle attacks where Router might return wrong UUID
 */
export async function verifyDerivedUuid(
  derivedUuid: string,
  publicKeyBase64: string,
): Promise<void> {
  try {
    const publicKeyBytes = fromBase64(publicKeyBase64);
    const hashBuffer = await crypto.subtle.digest("SHA-256", publicKeyBytes.buffer as ArrayBuffer);

    const base64 = toBase64(new Uint8Array(hashBuffer));
    const base64url = base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const expectedUuid = `peer_${base64url}`;

    if (derivedUuid !== expectedUuid) {
      logger.error("UUID verification failed", undefined, {
        received: derivedUuid,
        expected: expectedUuid,
      });
      throw new Error(
        `UUID verification failed: Router returned ${derivedUuid} but expected ${expectedUuid}. ` +
        `Possible man-in-the-middle attack or Router implementation error.`
      );
    }
  } catch (error) {
    logger.error("UUID derivation error", error as Error);
    throw error;
  }
}

/**
 * Sign challenge using Ed25519 private key
 * Uses canonical JSON format for consistent signing
 */
export async function signChallenge(
  challenge: string,
  privateKeyBase64: string,
): Promise<string> {
  // Import private key
  const privateKeyDer = fromBase64(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer.buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  // Create canonical payload
  const payload = canonicalizeJson(challenge);

  // Sign
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload.buffer as ArrayBuffer,
  );

  return toBase64(new Uint8Array(signature));
}
