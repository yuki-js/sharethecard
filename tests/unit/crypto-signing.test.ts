/**
 * Unit tests for signing module
 * Spec: Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect } from 'vitest';
import {
  generateEd25519KeyPairBase64,
  signDetachedEd25519,
  verifyDetachedEd25519,
  signJsonEd25519,
  verifyJsonEd25519,
  generateP256KeyPairBase64,
  signDetachedP256,
  verifyDetachedP256,
  signJsonP256,
  verifyJsonP256
} from '@remote-apdu/shared';

describe('Ed25519 Signing', () => {
  describe('generateEd25519KeyPairBase64', () => {
    it('should generate a valid keypair', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();

      expect(typeof publicKeySpkiBase64).toBe('string');
      expect(typeof privateKeyPkcs8Base64).toBe('string');
      expect(publicKeySpkiBase64.length).toBeGreaterThan(0);
      expect(privateKeyPkcs8Base64.length).toBeGreaterThan(0);
    });

    it('should generate different keypairs on each call', () => {
      const pair1 = generateEd25519KeyPairBase64();
      const pair2 = generateEd25519KeyPairBase64();

      expect(pair1.publicKeySpkiBase64).not.toBe(pair2.publicKeySpkiBase64);
      expect(pair1.privateKeyPkcs8Base64).not.toBe(pair2.privateKeyPkcs8Base64);
    });
  });

  describe('signDetachedEd25519', () => {
    it('should sign payload with private key', () => {
      const { privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('test payload', 'utf8'));

      const signature = signDetachedEd25519(payload, privateKeyPkcs8Base64);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should produce different signatures for different payloads', () => {
      const { privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const payload1 = new Uint8Array(Buffer.from('payload1', 'utf8'));
      const payload2 = new Uint8Array(Buffer.from('payload2', 'utf8'));

      const sig1 = signDetachedEd25519(payload1, privateKeyPkcs8Base64);
      const sig2 = signDetachedEd25519(payload2, privateKeyPkcs8Base64);

      expect(sig1).not.toBe(sig2);
    });

    it('should produce same signature for same payload (deterministic)', () => {
      const { privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('deterministic test', 'utf8'));

      const sig1 = signDetachedEd25519(payload, privateKeyPkcs8Base64);
      const sig2 = signDetachedEd25519(payload, privateKeyPkcs8Base64);

      expect(sig1).toBe(sig2);
    });
  });

  describe('verifyDetachedEd25519', () => {
    it('should verify valid signature', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('verify me', 'utf8'));

      const signature = signDetachedEd25519(payload, privateKeyPkcs8Base64);
      const isValid = verifyDetachedEd25519(payload, publicKeySpkiBase64, signature);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const { publicKeySpkiBase64 } = generateEd25519KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('test', 'utf8'));
      const badSignature = Buffer.from(new Uint8Array(64)).toString('base64');

      const isValid = verifyDetachedEd25519(payload, publicKeySpkiBase64, badSignature);

      expect(isValid).toBe(false);
    });

    it('should reject if payload is tampered', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('original', 'utf8'));
      const tampered = new Uint8Array(Buffer.from('tampered', 'utf8'));

      const signature = signDetachedEd25519(payload, privateKeyPkcs8Base64);
      const isValid = verifyDetachedEd25519(tampered, publicKeySpkiBase64, signature);

      expect(isValid).toBe(false);
    });

    it('should reject signature from wrong key', () => {
      const pair1 = generateEd25519KeyPairBase64();
      const pair2 = generateEd25519KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('test', 'utf8'));

      const signature = signDetachedEd25519(payload, pair1.privateKeyPkcs8Base64);
      const isValid = verifyDetachedEd25519(payload, pair2.publicKeySpkiBase64, signature);

      expect(isValid).toBe(false);
    });
  });

  describe('signJsonEd25519', () => {
    it('should sign JSON object', () => {
      const { privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const obj = { message: 'test', id: 123 };

      const signature = signJsonEd25519(obj, privateKeyPkcs8Base64);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should produce same signature regardless of key order (canonical)', () => {
      const { privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };

      const sig1 = signJsonEd25519(obj1, privateKeyPkcs8Base64);
      const sig2 = signJsonEd25519(obj2, privateKeyPkcs8Base64);

      expect(sig1).toBe(sig2);
    });
  });

  describe('verifyJsonEd25519', () => {
    it('should verify JSON signature', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const obj = { data: 'test', timestamp: Date.now() };

      const signature = signJsonEd25519(obj, privateKeyPkcs8Base64);
      const isValid = verifyJsonEd25519(obj, publicKeySpkiBase64, signature);

      expect(isValid).toBe(true);
    });

    it('should reject tampered JSON', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const original = { value: 100 };
      const tampered = { value: 101 };

      const signature = signJsonEd25519(original, privateKeyPkcs8Base64);
      const isValid = verifyJsonEd25519(tampered, publicKeySpkiBase64, signature);

      expect(isValid).toBe(false);
    });

    it('should verify regardless of key order', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const objForSign = { b: 2, a: 1 };
      const objForVerify = { a: 1, b: 2 };

      const signature = signJsonEd25519(objForSign, privateKeyPkcs8Base64);
      const isValid = verifyJsonEd25519(objForVerify, publicKeySpkiBase64, signature);

      expect(isValid).toBe(true);
    });
  });
});

describe('P-256 Signing', () => {
  describe('generateP256KeyPairBase64', () => {
    it('should generate a valid keypair', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateP256KeyPairBase64();

      expect(typeof publicKeySpkiBase64).toBe('string');
      expect(typeof privateKeyPkcs8Base64).toBe('string');
      expect(publicKeySpkiBase64.length).toBeGreaterThan(0);
      expect(privateKeyPkcs8Base64.length).toBeGreaterThan(0);
    });

    it('should generate different keypairs on each call', () => {
      const pair1 = generateP256KeyPairBase64();
      const pair2 = generateP256KeyPairBase64();

      expect(pair1.publicKeySpkiBase64).not.toBe(pair2.publicKeySpkiBase64);
      expect(pair1.privateKeyPkcs8Base64).not.toBe(pair2.privateKeyPkcs8Base64);
    });
  });

  describe('signDetachedP256', () => {
    it('should sign payload', () => {
      const { privateKeyPkcs8Base64 } = generateP256KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('test', 'utf8'));

      const signature = signDetachedP256(payload, privateKeyPkcs8Base64);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should verify signed payload', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateP256KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('verify', 'utf8'));

      const signature = signDetachedP256(payload, privateKeyPkcs8Base64);
      const isValid = verifyDetachedP256(payload, publicKeySpkiBase64, signature);

      expect(isValid).toBe(true);
    });

    it('should reject tampered payload', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateP256KeyPairBase64();
      const payload = new Uint8Array(Buffer.from('original', 'utf8'));
      const tampered = new Uint8Array(Buffer.from('tampered', 'utf8'));

      const signature = signDetachedP256(payload, privateKeyPkcs8Base64);
      const isValid = verifyDetachedP256(tampered, publicKeySpkiBase64, signature);

      expect(isValid).toBe(false);
    });
  });

  describe('signJsonP256', () => {
    it('should sign JSON', () => {
      const { privateKeyPkcs8Base64 } = generateP256KeyPairBase64();
      const obj = { test: 'data' };

      const signature = signJsonP256(obj, privateKeyPkcs8Base64);

      expect(typeof signature).toBe('string');
    });
  });

  describe('verifyJsonP256', () => {
    it('should verify JSON signature', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateP256KeyPairBase64();
      const obj = { challenge: 'abc123' };

      const signature = signJsonP256(obj, privateKeyPkcs8Base64);
      const isValid = verifyJsonP256(obj, publicKeySpkiBase64, signature);

      expect(isValid).toBe(true);
    });
  });
});
