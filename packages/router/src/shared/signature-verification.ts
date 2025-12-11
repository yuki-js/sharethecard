/**
 * Signature Verification Utilities
 * Shared Ed25519 signature verification logic
 */

const crypto = globalThis.crypto;

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
    const publicKeyDer = fromBase64(publicKeyBase64);
    const publicKey = await crypto.subtle.importKey(
      "spki",
      publicKeyDer.buffer as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    // Canonical payload (must match signer's canonicalization)
    const payload = canonicalizeJson(challenge);

    // Verify signature
    const signature = fromBase64(signatureBase64);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signature.buffer as ArrayBuffer,
      payload.buffer as ArrayBuffer,
    );
  } catch {
    return false;
  }
}