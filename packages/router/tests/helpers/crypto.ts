/**
 * Crypto Test Helpers
 * Shared cryptographic utilities for tests
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

function toUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Generate Ed25519 keypair for testing
 */
export async function generateEd25519KeyPair() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const publicKeySpki = await crypto.subtle.exportKey(
    "spki",
    keyPair.publicKey,
  );
  const privateKeyPkcs8 = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey,
  );

  return {
    publicKey: toBase64(new Uint8Array(publicKeySpki)),
    privateKey: toBase64(new Uint8Array(privateKeyPkcs8)),
    keyPair,
  };
}

/**
 * Sign challenge with Ed25519 private key
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

  const payload = toUtf8(JSON.stringify(challenge));
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload.buffer as ArrayBuffer,
  );

  return toBase64(new Uint8Array(signature));
}