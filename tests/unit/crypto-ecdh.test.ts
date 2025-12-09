/**
 * Unit tests for ECDH module
 * Spec: Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPairBase64,
  computeSharedSecretX25519,
  generateP256EcdhKeyPairBase64,
  computeSharedSecretP256
} from '@remote-apdu/shared';

describe('X25519 ECDH', () => {
  describe('generateX25519KeyPairBase64', () => {
    it('should generate a valid keypair', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateX25519KeyPairBase64();

      expect(typeof publicKeySpkiBase64).toBe('string');
      expect(typeof privateKeyPkcs8Base64).toBe('string');
      expect(publicKeySpkiBase64.length).toBeGreaterThan(0);
      expect(privateKeyPkcs8Base64.length).toBeGreaterThan(0);
    });

    it('should generate different keypairs on each call', () => {
      const pair1 = generateX25519KeyPairBase64();
      const pair2 = generateX25519KeyPairBase64();

      expect(pair1.publicKeySpkiBase64).not.toBe(pair2.publicKeySpkiBase64);
      expect(pair1.privateKeyPkcs8Base64).not.toBe(pair2.privateKeyPkcs8Base64);
    });
  });

  describe('computeSharedSecretX25519', () => {
    it('should compute shared secret from keypairs', () => {
      const alice = generateX25519KeyPairBase64();
      const bob = generateX25519KeyPairBase64();

      const aliceSecret = computeSharedSecretX25519(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);
      const bobSecret = computeSharedSecretX25519(bob.privateKeyPkcs8Base64, alice.publicKeySpkiBase64);

      expect(aliceSecret).toBeInstanceOf(Uint8Array);
      expect(bobSecret).toBeInstanceOf(Uint8Array);
      expect(aliceSecret).toEqual(bobSecret);
    });

    it('should produce same secret for same keypairs (deterministic)', () => {
      const alice = generateX25519KeyPairBase64();
      const bob = generateX25519KeyPairBase64();

      const secret1 = computeSharedSecretX25519(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);
      const secret2 = computeSharedSecretX25519(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);

      expect(secret1).toEqual(secret2);
    });

    it('should produce different secrets for different keypairs', () => {
      const alice = generateX25519KeyPairBase64();
      const bob = generateX25519KeyPairBase64();
      const charlie = generateX25519KeyPairBase64();

      const secret1 = computeSharedSecretX25519(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);
      const secret2 = computeSharedSecretX25519(alice.privateKeyPkcs8Base64, charlie.publicKeySpkiBase64);

      expect(secret1).not.toEqual(secret2);
    });

    it('should produce 32-byte shared secret', () => {
      const alice = generateX25519KeyPairBase64();
      const bob = generateX25519KeyPairBase64();

      const secret = computeSharedSecretX25519(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);

      expect(secret.byteLength).toBe(32);
    });

    it('should fail with invalid private key', () => {
      const bob = generateX25519KeyPairBase64();
      const invalidPrivateKey = 'invalid-key-format';

      expect(() => computeSharedSecretX25519(invalidPrivateKey, bob.publicKeySpkiBase64)).toThrow();
    });

    it('should fail with invalid public key', () => {
      const alice = generateX25519KeyPairBase64();
      const invalidPublicKey = 'invalid-key-format';

      expect(() => computeSharedSecretX25519(alice.privateKeyPkcs8Base64, invalidPublicKey)).toThrow();
    });
  });
});

describe('P-256 ECDH', () => {
  describe('generateP256EcdhKeyPairBase64', () => {
    it('should generate a valid keypair', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateP256EcdhKeyPairBase64();

      expect(typeof publicKeySpkiBase64).toBe('string');
      expect(typeof privateKeyPkcs8Base64).toBe('string');
      expect(publicKeySpkiBase64.length).toBeGreaterThan(0);
      expect(privateKeyPkcs8Base64.length).toBeGreaterThan(0);
    });

    it('should generate different keypairs on each call', () => {
      const pair1 = generateP256EcdhKeyPairBase64();
      const pair2 = generateP256EcdhKeyPairBase64();

      expect(pair1.publicKeySpkiBase64).not.toBe(pair2.publicKeySpkiBase64);
      expect(pair1.privateKeyPkcs8Base64).not.toBe(pair2.privateKeyPkcs8Base64);
    });
  });

  describe('computeSharedSecretP256', () => {
    it('should compute shared secret from keypairs', () => {
      const alice = generateP256EcdhKeyPairBase64();
      const bob = generateP256EcdhKeyPairBase64();

      const aliceSecret = computeSharedSecretP256(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);
      const bobSecret = computeSharedSecretP256(bob.privateKeyPkcs8Base64, alice.publicKeySpkiBase64);

      expect(aliceSecret).toBeInstanceOf(Uint8Array);
      expect(bobSecret).toBeInstanceOf(Uint8Array);
      expect(aliceSecret).toEqual(bobSecret);
    });

    it('should produce same secret for same keypairs (deterministic)', () => {
      const alice = generateP256EcdhKeyPairBase64();
      const bob = generateP256EcdhKeyPairBase64();

      const secret1 = computeSharedSecretP256(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);
      const secret2 = computeSharedSecretP256(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);

      expect(secret1).toEqual(secret2);
    });

    it('should produce different secrets for different keypairs', () => {
      const alice = generateP256EcdhKeyPairBase64();
      const bob = generateP256EcdhKeyPairBase64();
      const charlie = generateP256EcdhKeyPairBase64();

      const secret1 = computeSharedSecretP256(alice.privateKeyPkcs8Base64, bob.publicKeySpkiBase64);
      const secret2 = computeSharedSecretP256(alice.privateKeyPkcs8Base64, charlie.publicKeySpkiBase64);

      expect(secret1).not.toEqual(secret2);
    });

    it('should fail with invalid private key', () => {
      const bob = generateP256EcdhKeyPairBase64();
      const invalidPrivateKey = 'invalid-key';

      expect(() => computeSharedSecretP256(invalidPrivateKey, bob.publicKeySpkiBase64)).toThrow();
    });

    it('should fail with invalid public key', () => {
      const alice = generateP256EcdhKeyPairBase64();
      const invalidPublicKey = 'invalid-key';

      expect(() => computeSharedSecretP256(alice.privateKeyPkcs8Base64, invalidPublicKey)).toThrow();
    });
  });
});
