/**
 * Signature Verification Utilities
 * Shared Ed25519 signature verification logic
 */

import { webcrypto } from "node:crypto";
import { canonicalizeJson } from "@remote-apdu/shared";

/**
 * Verify Ed25519 signature using webcrypto
 * 
 * @param challenge - Challenge string to verify
 * @param publicKeyBase64 - SPKI-encoded Ed25519 public key in base64
 * @param signatureBase64 - Ed25519 signature in base64
 * @returns true if signature is valid, false otherwise
 */
export async function verifyEd25519Signature(
  challenge: string,
  publicKeyBase64: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    // Import Ed25519 public key
    const publicKeyDer = Buffer.from(publicKeyBase64, "base64");
    const publicKey = await webcrypto.subtle.importKey(
      "spki",
      publicKeyDer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    // Canonical payload (must match signer's canonicalization)
    const payload = canonicalizeJson(challenge);

    // Verify signature
    const signature = Buffer.from(signatureBase64, "base64");
    return await webcrypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signature,
      payload,
    );
  } catch {
    return false;
  }
}