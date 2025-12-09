/**
 * Authentication Utilities for Controller
 * Handles cryptographic operations for WebSocket-based authentication
 *
 * これらのユーティリティは router-transport.ts で使用される
 */

import { webcrypto } from "node:crypto";
import { canonicalizeJson, createLogger } from "@remote-apdu/shared";

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
    const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
    const hashBuffer = await webcrypto.subtle.digest("SHA-256", publicKeyBytes);

    const base64 = Buffer.from(hashBuffer).toString("base64");
    const base64url = base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const expectedId = `peer_${base64url}`;

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
  const privateKeyDer = Buffer.from(privateKeyBase64, "base64");
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    privateKeyDer,
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  // Create canonical payload
  const payload = canonicalizeJson(challenge);

  // Sign
  const signature = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload,
  );

  return Buffer.from(signature).toString("base64");
}
