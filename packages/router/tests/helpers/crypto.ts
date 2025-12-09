/**
 * Crypto Test Helpers
 * Shared cryptographic utilities for tests
 */

import { webcrypto } from "node:crypto";

/**
 * Generate Ed25519 keypair for testing
 */
export async function generateEd25519KeyPair() {
  const keyPair = (await webcrypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const publicKeySpki = await webcrypto.subtle.exportKey(
    "spki",
    keyPair.publicKey,
  );
  const privateKeyPkcs8 = await webcrypto.subtle.exportKey(
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
 * Sign challenge with Ed25519 private key
 */
export async function signChallenge(
  challenge: string,
  privateKeyBase64: string,
): Promise<string> {
  const privateKeyDer = Buffer.from(privateKeyBase64, "base64");
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    privateKeyDer,
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  const payload = new Uint8Array(
    Buffer.from(JSON.stringify(challenge), "utf8"),
  );
  const signature = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload,
  );

  return Buffer.from(signature).toString("base64");
}