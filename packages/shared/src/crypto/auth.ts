/**
 * Shared authentication helpers (environment-agnostic)
 * - Uses globalThis.crypto and shared encoding/canonicalization
 * - DRY consolidation for controller/cardhost sign/verify functions
 */

const crypto = globalThis.crypto as Crypto;

import { fromBase64, toBase64, prepareSigningPayload, deriveIdFromPublicKeyHash } from "../utils/encoding.js";

/**
 * Sign challenge using Ed25519 private key (PKCS8 base64)
 * Payload is canonicalized to ensure deterministic signing.
 */
export async function signChallenge(
  challenge: string,
  privateKeyBase64: string,
): Promise<string> {
  const privateKeyDer = fromBase64(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer.buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  const payload = prepareSigningPayload(challenge);

  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload.buffer as ArrayBuffer,
  );

  return toBase64(new Uint8Array(signature));
}

/**
 * Verify that a peer ID (controllerId/uuid) matches the derived ID from public key.
 * Throws on mismatch.
 */
export async function verifyDerivedPeerId(
  peerId: string,
  publicKeyBase64: string,
): Promise<void> {
  const expected = await deriveIdFromPublicKeyHash(publicKeyBase64);
  if (peerId !== expected) {
    throw new Error(
      `Peer ID verification failed: received ${peerId}, expected ${expected}. ` +
      `Possible MITM or Router derivation error.`,
    );
  }
}