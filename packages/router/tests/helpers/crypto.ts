/**
 * Crypto Test Helpers
 * Shared cryptographic utilities for tests
 */

const crypto = globalThis.crypto;
import { toBase64, fromBase64, toUtf8 } from "@remote-apdu/shared";

/**
 * Generate Ed25519 keypair for testing
 */
export async function generateEd25519KeyPair() {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

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
