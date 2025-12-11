/**
 * Authentication Utilities for Cardhost
 * Handles cryptographic operations for WebSocket-based authentication
 *
 * これらのユーティリティは router-transport.ts で使用される
 */

const crypto = globalThis.crypto;
import { createLogger, fromBase64, toBase64, prepareSigningPayload, deriveIdFromPublicKeyHash } from "../../../shared/src/index.js";

const logger = createLogger("cardhost:auth-utils");



/**
 * Verify that Router-derived UUID matches public key hash
 * This prevents man-in-the-middle attacks where Router might return wrong UUID
 */
export async function verifyDerivedUuid(
  derivedUuid: string,
  publicKeyBase64: string,
): Promise<void> {
  try {
    // TODO: Replace base64url-derived ID with RFC 4122 UUID (e.g., v5 deterministic). See shared utils.
    // Temporary derivation centralized in shared utils
    const expectedUuid = await deriveIdFromPublicKeyHash(publicKeyBase64);

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
  const payload = prepareSigningPayload(challenge);

  // Sign
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload.buffer as ArrayBuffer,
  );

  return toBase64(new Uint8Array(signature));
}
