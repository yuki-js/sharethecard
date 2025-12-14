/**
 * Controller-local crypto helpers
 * - Moved from @remote-apdu/shared to keep the shared package limited to multi-package utilities
 * - Avoids coupling shared to functions used only by the controller
 */

const crypto = globalThis.crypto as Crypto;
import { toBase64 } from "@remote-apdu/shared";

/**
 * Export an Ed25519 keypair to base64 strings (SPKI public, PKCS8 private).
 */
export async function exportEd25519KeyPair(
  keyPair: CryptoKeyPair,
): Promise<{ publicKey: string; privateKey: string }> {
  const [publicKeyDer, privateKeyDer] = await Promise.all([
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);

  return {
    publicKey: toBase64(new Uint8Array(publicKeyDer as ArrayBuffer)),
    privateKey: toBase64(new Uint8Array(privateKeyDer as ArrayBuffer)),
  };
}