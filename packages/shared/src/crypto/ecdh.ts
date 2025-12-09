import { webcrypto } from 'node:crypto';

/**
 * SubtleCrypto-based Elliptic Curve Diffie-Hellman helpers for ephemeral key exchange.
 * - X25519 (recommended) via WebCrypto (Node.js SubtleCrypto)
 * - P-256 (prime256v1) alternative via WebCrypto ECDH
 *
 * Keys are exported/imported in DER base64:
 * - Private: PKCS8
 * - Public:  SPKI
 */

const subtle = webcrypto.subtle;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function exportPrivateKeyPkcs8Base64(key: CryptoKey): Promise<string> {
  const der = await subtle.exportKey('pkcs8', key);
  return toBase64(new Uint8Array(der));
}

async function exportPublicKeySpkiBase64(key: CryptoKey): Promise<string> {
  const der = await subtle.exportKey('spki', key);
  return toBase64(new Uint8Array(der));
}

/**
 * Generate an X25519 key pair for ECDH (SubtleCrypto).
 */
export async function generateX25519KeyPairBase64(): Promise<{ publicKeySpkiBase64: string; privateKeyPkcs8Base64: string }> {
  const { publicKey, privateKey } = await subtle.generateKey(
    // Node's WebCrypto supports "X25519" for ECDH
    { name: 'X25519' },
    true,
    ['deriveBits']
  ) as CryptoKeyPair;

  const publicKeySpkiBase64 = await exportPublicKeySpkiBase64(publicKey);
  const privateKeyPkcs8Base64 = await exportPrivateKeyPkcs8Base64(privateKey);

  return { publicKeySpkiBase64, privateKeyPkcs8Base64 };
}

async function importPrivateKeyPkcs8X25519(base64: string): Promise<CryptoKey> {
  const pkcs8 = fromBase64(base64);
  return await subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'X25519' },
    false,
    ['deriveBits']
  );
}

async function importPublicKeySpkiX25519(base64: string): Promise<CryptoKey> {
  const spki = fromBase64(base64);
  return await subtle.importKey(
    'spki',
    spki,
    { name: 'X25519' },
    false,
    []
  );
}

/**
 * Compute X25519 shared secret from our private key and peer public key (SubtleCrypto).
 * Returns raw shared secret bytes (32 bytes).
 */
export async function computeSharedSecretX25519(
  privateKeyPkcs8Base64: string,
  peerPublicKeySpkiBase64: string
): Promise<Uint8Array> {
  const priv = await importPrivateKeyPkcs8X25519(privateKeyPkcs8Base64);
  const pub = await importPublicKeySpkiX25519(peerPublicKeySpkiBase64);

  const bits = await subtle.deriveBits(
    { name: 'X25519', public: pub },
    priv,
    32 * 8 // 32 bytes
  );

  return new Uint8Array(bits);
}

/**
 * Generate a P-256 (prime256v1) ECDH key pair (SubtleCrypto).
 */
export async function generateP256EcdhKeyPairBase64(): Promise<{ publicKeySpkiBase64: string; privateKeyPkcs8Base64: string }> {
  const { publicKey, privateKey } = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  ) as CryptoKeyPair;

  const publicKeySpkiBase64 = await exportPublicKeySpkiBase64(publicKey);
  const privateKeyPkcs8Base64 = await exportPrivateKeyPkcs8Base64(privateKey);

  return { publicKeySpkiBase64, privateKeyPkcs8Base64 };
}

async function importPrivateKeyPkcs8P256(base64: string): Promise<CryptoKey> {
  const pkcs8 = fromBase64(base64);
  return await subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
}

async function importPublicKeySpkiP256(base64: string): Promise<CryptoKey> {
  const spki = fromBase64(base64);
  return await subtle.importKey(
    'spki',
    spki,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

/**
 * Compute P-256 ECDH shared secret from our private key and peer public key (SubtleCrypto).
 * Returns 32-byte shared secret derived bits.
 */
export async function computeSharedSecretP256(
  privateKeyPkcs8Base64: string,
  peerPublicKeySpkiBase64: string
): Promise<Uint8Array> {
  const priv = await importPrivateKeyPkcs8P256(privateKeyPkcs8Base64);
  const pub = await importPublicKeySpkiP256(peerPublicKeySpkiBase64);

  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: pub },
    priv,
    32 * 8 // derive 32 bytes
  );

  return new Uint8Array(bits);
}