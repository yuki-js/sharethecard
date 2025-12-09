import { webcrypto } from 'node:crypto';
import { canonicalizeJson } from './encryption.js';

const subtle = webcrypto.subtle;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function exportPrivateKeyPkcs8Base64(key: CryptoKey): Promise<string> {
  const der = await subtle.exportKey('pkcs8', key);
  return Buffer.from(new Uint8Array(der)).toString('base64');
}

async function exportPublicKeySpkiBase64(key: CryptoKey): Promise<string> {
  const der = await subtle.exportKey('spki', key);
  return Buffer.from(new Uint8Array(der)).toString('base64');
}

/**
 * Ed25519 signing utilities implemented with SubtleCrypto
 */
export async function generateEd25519KeyPairBase64(): Promise<{ publicKeySpkiBase64: string; privateKeyPkcs8Base64: string }> {
  const keyPair = (await subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const publicKeySpkiBase64 = await exportPublicKeySpkiBase64(keyPair.publicKey);
  const privateKeyPkcs8Base64 = await exportPrivateKeyPkcs8Base64(keyPair.privateKey);
  return { publicKeySpkiBase64, privateKeyPkcs8Base64 };
}

async function importPrivateKeyPkcs8Ed25519(base64: string): Promise<CryptoKey> {
  const pkcs8 = fromBase64(base64);
  return await subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
}

async function importPublicKeySpkiEd25519(base64: string): Promise<CryptoKey> {
  const spki = fromBase64(base64);
  return await subtle.importKey(
    'spki',
    spki,
    { name: 'Ed25519' },
    false,
    ['verify']
  );
}

export async function signDetachedEd25519(payload: Uint8Array, privateKeyPkcs8Base64: string): Promise<string> {
  const priv = await importPrivateKeyPkcs8Ed25519(privateKeyPkcs8Base64);
  const sig = await subtle.sign({ name: 'Ed25519' }, priv, payload);
  return toBase64(new Uint8Array(sig));
}

export async function verifyDetachedEd25519(payload: Uint8Array, publicKeySpkiBase64: string, signatureBase64: string): Promise<boolean> {
  const pub = await importPublicKeySpkiEd25519(publicKeySpkiBase64);
  const sig = fromBase64(signatureBase64);
  return await subtle.verify({ name: 'Ed25519' }, pub, sig, payload);
}

export async function signJsonEd25519(input: unknown, privateKeyPkcs8Base64: string): Promise<string> {
  const payload = canonicalizeJson(input);
  return await signDetachedEd25519(payload, privateKeyPkcs8Base64);
}

export async function verifyJsonEd25519(input: unknown, publicKeySpkiBase64: string, signatureBase64: string): Promise<boolean> {
  const payload = canonicalizeJson(input);
  return await verifyDetachedEd25519(payload, publicKeySpkiBase64, signatureBase64);
}

/**
 * ECDSA P-256 signing utilities implemented with SubtleCrypto
 */
export async function generateP256KeyPairBase64(): Promise<{ publicKeySpkiBase64: string; privateKeyPkcs8Base64: string }> {
  const keyPair = (await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const publicKeySpkiBase64 = await exportPublicKeySpkiBase64(keyPair.publicKey);
  const privateKeyPkcs8Base64 = await exportPrivateKeyPkcs8Base64(keyPair.privateKey);
  return { publicKeySpkiBase64, privateKeyPkcs8Base64 };
}

async function importPrivateKeyPkcs8P256(base64: string): Promise<CryptoKey> {
  const pkcs8 = fromBase64(base64);
  return await subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function importPublicKeySpkiP256(base64: string): Promise<CryptoKey> {
  const spki = fromBase64(base64);
  return await subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

export async function signDetachedP256(payload: Uint8Array, privateKeyPkcs8Base64: string): Promise<string> {
  const priv = await importPrivateKeyPkcs8P256(privateKeyPkcs8Base64);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, payload);
  return toBase64(new Uint8Array(sig));
}

export async function verifyDetachedP256(payload: Uint8Array, publicKeySpkiBase64: string, signatureBase64: string): Promise<boolean> {
  const pub = await importPublicKeySpkiP256(publicKeySpkiBase64);
  const sig = fromBase64(signatureBase64);
  return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, payload);
}

export async function signJsonP256(input: unknown, privateKeyPkcs8Base64: string): Promise<string> {
  const payload = canonicalizeJson(input);
  return await signDetachedP256(payload, privateKeyPkcs8Base64);
}

export async function verifyJsonP256(input: unknown, publicKeySpkiBase64: string, signatureBase64: string): Promise<boolean> {
  const payload = canonicalizeJson(input);
  return await verifyDetachedP256(payload, publicKeySpkiBase64, signatureBase64);
}