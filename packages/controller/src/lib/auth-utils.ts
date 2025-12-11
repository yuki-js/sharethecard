/**
 * Authentication Utilities for Controller
 * Handles cryptographic operations for WebSocket-based authentication
 *
 * これらのユーティリティは router-transport.ts で使用される
 */

const crypto = globalThis.crypto;
import { createLogger, fromBase64, toBase64, prepareSigningPayload, deriveIdFromPublicKeyHash } from "../../../shared/src/index.js";

const logger = createLogger("controller:auth-utils");



/**
 * Verify that Router-derived Controller ID matches public key hash
 * This prevents man-in-the-middle attacks where Router might return wrong ID
 */
export async function verifyDerivedControllerId(
  controllerId: string,
  publicKeyBase64: string,
): Promise<void> {
  try {
    // TODO: Replace base64url-derived ID with RFC 4122 UUID (e.g., v5 deterministic). See shared utils.
    // Temporary derivation centralized in shared utils
    const expectedId = await deriveIdFromPublicKeyHash(publicKeyBase64);

    if (controllerId !== expectedId) {
      logger.error("Controller ID verification failed", undefined, {
        received: controllerId,
        expected: expectedId,
      });
      throw new Error(
        `Controller ID verification failed: Router returned ${controllerId} but expected ${expectedId}. ` +
        `Possible man-in-the-middle attack or Router implementation error.`
      );
    }
  } catch (error) {
    logger.error("ID derivation error", error as Error);
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
