/**
 * Authentication Utilities for Cardhost
 * Handles cryptographic operations for WebSocket-based authentication
 *
 * これらのユーティリティは router-transport.ts で使用される
 */

const crypto = globalThis.crypto;
import { fromBase64, toBase64, prepareSigningPayload } from "@remote-apdu/shared";

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
