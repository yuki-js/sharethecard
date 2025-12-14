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
 /**
  * Sign challenge with Ed25519 private key (delegated to shared helper)
  */
 import { signChallenge as sharedSignChallenge } from "@remote-apdu/shared";
 
 export async function signChallenge(
   challenge: string,
   privateKeyBase64: string,
 ): Promise<string> {
   return await sharedSignChallenge(challenge, privateKeyBase64);
 }