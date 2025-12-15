/**
 * Crypto Test Helpers
 * Shared cryptographic utilities for tests
 */

const crypto = globalThis.crypto;
import { signChallenge as sharedSignChallenge } from "@remote-apdu/shared";

/**
 * Generate Ed25519 keypair for testing
 * Returns base64-encoded SPKI public key and PKCS8 private key along with the CryptoKeyPair.
 */
export async function generateEd25519KeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
  keyPair: CryptoKeyPair;
}> {
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
    publicKey: Buffer.from(publicKeySpki).toString("base64"),
    privateKey: Buffer.from(privateKeyPkcs8).toString("base64"),
    keyPair,
  };
}

/**
 * Sign challenge with Ed25519 private key (delegated to shared helper)
 */
export async function signChallenge(
  challenge: string,
  privateKeyBase64: string,
): Promise<string> {
  return await sharedSignChallenge(challenge, privateKeyBase64);
}
