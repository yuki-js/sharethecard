import { webcrypto } from 'node:crypto';
import { EncryptedMessage } from '../protocol/messages.js';

/**
 * SubtleCrypto-based utilities and primitives for E2E encryption:
 * - AES-256-GCM encrypt/decrypt (async)
 * - HKDF-SHA256 session key derivation (async)
 * - Canonical JSON serialization for signature/MAC inputs
 */

const IV_LENGTH = 12; // Recommended length for AES-GCM
const subtle = webcrypto.subtle;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Generate a random 12-byte IV suitable for AES-GCM using SubtleCrypto.
 */
export function generateIv(): Uint8Array {
  const iv = new Uint8Array(IV_LENGTH);
  webcrypto.getRandomValues(iv);
  return iv;
}

async function importAesGcmKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.byteLength !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  return await subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext using AES-256-GCM (SubtleCrypto).
 * Key must be 32 bytes (256-bit).
 */
export async function encryptAesGcm(
  plaintext: Uint8Array,
  key: Uint8Array,
  iv?: Uint8Array
): Promise<Pick<EncryptedMessage, 'iv' | 'ciphertext' | 'authTag'>> {
  const useIv = iv ?? generateIv();
  if (useIv.byteLength !== IV_LENGTH) {
    throw new Error(`AES-GCM IV must be ${IV_LENGTH} bytes`);
  }
  const cryptoKey = await importAesGcmKey(key);

  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: useIv },
    cryptoKey,
    plaintext
  );

  // WebCrypto returns ciphertext concatenated with auth tag at the end.
  // Node SubtleCrypto returns raw ciphertext with tag appended (16 bytes).
  const ciphertext = new Uint8Array(cipherBuf);
  if (ciphertext.byteLength < 16) {
    throw new Error('Ciphertext too short');
  }
  const tagLen = 16;
  const ctWithoutTag = ciphertext.subarray(0, ciphertext.byteLength - tagLen);
  const authTag = ciphertext.subarray(ciphertext.byteLength - tagLen);

  return {
    iv: toBase64(useIv),
    ciphertext: toBase64(ctWithoutTag),
    authTag: toBase64(authTag)
  };
}

/**
 * Decrypt AES-256-GCM payload (SubtleCrypto).
 */
export async function decryptAesGcm(
  encrypted: Pick<EncryptedMessage, 'iv' | 'ciphertext' | 'authTag'>,
  key: Uint8Array
): Promise<Uint8Array> {
  const iv = fromBase64(encrypted.iv);
  if (iv.byteLength !== IV_LENGTH) {
    throw new Error(`AES-GCM IV must be ${IV_LENGTH} bytes`);
  }
  const authTag = fromBase64(encrypted.authTag);
  const ciphertext = fromBase64(encrypted.ciphertext);

  // Re-append tag to ciphertext as expected by SubtleCrypto
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.byteLength);

  const cryptoKey = await importAesGcmKey(key);
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    combined
  );

  return new Uint8Array(plainBuf);
}

/**
 * Derive a session key using HKDF-SHA256 from shared secret (SubtleCrypto).
 * - sharedSecret: ECDH shared secret bytes
 * - salt: random salt bytes
 * - info: context string bytes (e.g., 'remote-apdu-session')
 * - length: desired key length in bytes (default 32 for AES-256)
 */
export async function deriveSessionKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length = 32
): Promise<Uint8Array> {
  // HKDF deriveBits in SubtleCrypto
  const baseKey = await subtle.importKey(
    'raw',
    sharedSecret,
    'HKDF',
    false,
    ['deriveBits']
  );

  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info
    },
    baseKey,
    length * 8
  );

  return new Uint8Array(bits);
}

/**
 * Canonicalize JSON deterministically by sorting object keys recursively.
 * Returns UTF-8 bytes suitable for signing/MAC input.
 */
export function canonicalizeJson(input: unknown): Uint8Array {
  const canonical = JSON.stringify(sortKeys(input));
  return new Uint8Array(Buffer.from(canonical, 'utf8'));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeys(v));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const obj: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      obj[k] = sortKeys(v);
    }
    return obj;
  }
  return value;
}