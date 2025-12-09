/**
 * Peer ID Utilities
 * 
 * Peer ID is derived from public key to prevent:
 * - Collision attacks
 * - Impersonation attacks  
 * - Namespace pollution
 * 
 * The peer cannot choose their own ID - it is deterministically
 * derived from their public key.
 */

import { webcrypto } from "node:crypto";

/**
 * Generate peer ID from public key using SHA-256
 * Returns base64url-encoded hash (safe for URLs)
 * 
 * @param publicKeyBase64 - SPKI-encoded Ed25519 public key in base64
 * @returns Deterministic peer ID derived from public key
 */
export async function generatePeerId(publicKeyBase64: string): Promise<string> {
  const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
  
  // Hash the public key
  const hashBuffer = await webcrypto.subtle.digest("SHA-256", publicKeyBytes);
  
  // Convert to base64url (URL-safe)
  const base64 = Buffer.from(hashBuffer).toString("base64");
  const base64url = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  return `peer_${base64url}`;
}

/**
 * Verify that a peer ID matches the public key
 * 
 * @param peerId - Claimed peer ID
 * @param publicKeyBase64 - Public key to verify against
 * @returns true if peer ID is correctly derived from public key
 */
export async function verifyPeerId(
  peerId: string,
  publicKeyBase64: string,
): Promise<boolean> {
  const expectedPeerId = await generatePeerId(publicKeyBase64);
  return peerId === expectedPeerId;
}