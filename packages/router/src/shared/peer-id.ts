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

const crypto = globalThis.crypto;

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
 * Generate peer ID from public key using SHA-256
 * Returns base64url-encoded hash (safe for URLs)
 * 
 * @param publicKeyBase64 - SPKI-encoded Ed25519 public key in base64
 * @returns Deterministic peer ID derived from public key
 */
export async function generatePeerId(publicKeyBase64: string): Promise<string> {
  const publicKeyBytes = fromBase64(publicKeyBase64);
  
  // Hash the public key
  const hashBuffer = await crypto.subtle.digest("SHA-256", publicKeyBytes.buffer as ArrayBuffer);
  
  // Convert to base64url (URL-safe)
  const base64 = toBase64(new Uint8Array(hashBuffer));
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