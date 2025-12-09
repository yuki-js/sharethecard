/**
 * Unit tests for encryption module
 * Spec: Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generateIv,
  encryptAesGcm,
  decryptAesGcm,
  deriveSessionKey,
  canonicalizeJson
} from '@remote-apdu/shared';

describe('Encryption Utilities', () => {
  describe('generateIv', () => {
    it('should generate a 12-byte IV', () => {
      const iv = generateIv();
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.byteLength).toBe(12);
    });

    it('should generate different IVs on each call', () => {
      const iv1 = generateIv();
      const iv2 = generateIv();
      expect(iv1).not.toEqual(iv2);
    });
  });

  describe('encryptAesGcm', () => {
    it('should encrypt plaintext with 32-byte key', () => {
      const plaintext = new Uint8Array(Buffer.from('Hello, World!', 'utf8'));
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);

      const result = encryptAesGcm(plaintext, key);

      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('authTag');
      expect(typeof result.iv).toBe('string');
      expect(typeof result.ciphertext).toBe('string');
      expect(typeof result.authTag).toBe('string');
    });

    it('should throw error if key is not 32 bytes', () => {
      const plaintext = new Uint8Array(Buffer.from('Hello', 'utf8'));
      const badKey = new Uint8Array(16);

      expect(() => encryptAesGcm(plaintext, badKey)).toThrow('AES-256-GCM requires a 32-byte key');
    });

    it('should use provided IV', () => {
      const plaintext = new Uint8Array(Buffer.from('Test', 'utf8'));
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);
      const customIv = new Uint8Array(12);
      crypto.getRandomValues(customIv);

      const result = encryptAesGcm(plaintext, key, customIv);

      // IV should be deterministic when provided
      expect(result.iv).toBe(Buffer.from(customIv).toString('base64'));
    });

    it('should throw error if IV is not 12 bytes', () => {
      const plaintext = new Uint8Array(Buffer.from('Test', 'utf8'));
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);
      const badIv = new Uint8Array(16);

      expect(() => encryptAesGcm(plaintext, key, badIv)).toThrow('AES-GCM IV must be 12 bytes');
    });

    it('should encrypt empty plaintext', () => {
      const plaintext = new Uint8Array(0);
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);

      const result = encryptAesGcm(plaintext, key);

      expect(result.ciphertext).toBeDefined();
      expect(result.authTag).toBeDefined();
    });
  });

  describe('decryptAesGcm', () => {
    it('should decrypt encrypted payload', () => {
      const plaintext = new Uint8Array(Buffer.from('Secret Message', 'utf8'));
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);

      const encrypted = encryptAesGcm(plaintext, key);
      const decrypted = decryptAesGcm(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should throw error if key is not 32 bytes', () => {
      const encrypted = { iv: Buffer.from(new Uint8Array(12)).toString('base64'), ciphertext: 'test', authTag: 'test' };
      const badKey = new Uint8Array(16);

      expect(() => decryptAesGcm(encrypted, badKey)).toThrow('AES-256-GCM requires a 32-byte key');
    });

    it('should throw error on invalid ciphertext', () => {
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);

      const encrypted = {
        iv: Buffer.from(new Uint8Array(12)).toString('base64'),
        ciphertext: Buffer.from('corrupted').toString('base64'),
        authTag: Buffer.from(new Uint8Array(16)).toString('base64')
      };

      expect(() => decryptAesGcm(encrypted, key)).toThrow();
    });

    it('should handle empty ciphertext', () => {
      const plaintext = new Uint8Array(0);
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);

      const encrypted = encryptAesGcm(plaintext, key);
      const decrypted = decryptAesGcm(encrypted, key);

      expect(decrypted.length).toBe(0);
    });
  });

  describe('deriveSessionKey', () => {
    it('should derive a 32-byte key by default', () => {
      const sharedSecret = new Uint8Array(32);
      crypto.getRandomValues(sharedSecret);
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('test-info', 'utf8'));

      const key = deriveSessionKey(sharedSecret, salt, info);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.byteLength).toBe(32);
    });

    it('should derive different key lengths', () => {
      const sharedSecret = new Uint8Array(32);
      crypto.getRandomValues(sharedSecret);
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('test', 'utf8'));

      const key16 = deriveSessionKey(sharedSecret, salt, info, 16);
      const key64 = deriveSessionKey(sharedSecret, salt, info, 64);

      expect(key16.byteLength).toBe(16);
      expect(key64.byteLength).toBe(64);
    });

    it('should derive deterministic key from same inputs', () => {
      const sharedSecret = new Uint8Array(32);
      crypto.getRandomValues(sharedSecret);
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('deterministic', 'utf8'));

      const key1 = deriveSessionKey(sharedSecret, salt, info);
      const key2 = deriveSessionKey(sharedSecret, salt, info);

      expect(key1).toEqual(key2);
    });

    it('should derive different keys with different salts', () => {
      const sharedSecret = new Uint8Array(32);
      crypto.getRandomValues(sharedSecret);
      const salt1 = new Uint8Array(32);
      crypto.getRandomValues(salt1);
      const salt2 = new Uint8Array(32);
      crypto.getRandomValues(salt2);
      const info = new Uint8Array(Buffer.from('test', 'utf8'));

      const key1 = deriveSessionKey(sharedSecret, salt1, info);
      const key2 = deriveSessionKey(sharedSecret, salt2, info);

      expect(key1).not.toEqual(key2);
    });
  });

  describe('canonicalizeJson', () => {
    it('should canonicalize simple objects', () => {
      const input = { b: 2, a: 1 };
      const canonical = canonicalizeJson(input);

      const expected = Buffer.from('{"a":1,"b":2}', 'utf8');
      expect(canonical).toEqual(new Uint8Array(expected));
    });

    it('should sort object keys recursively', () => {
      const input = { z: { b: 2, a: 1 }, y: 3 };
      const canonical = canonicalizeJson(input);

      const expected = Buffer.from('{"y":3,"z":{"a":1,"b":2}}', 'utf8');
      expect(canonical).toEqual(new Uint8Array(expected));
    });

    it('should handle arrays', () => {
      const input = [3, 1, 2];
      const canonical = canonicalizeJson(input);

      const expected = Buffer.from('[3,1,2]', 'utf8');
      expect(canonical).toEqual(new Uint8Array(expected));
    });

    it('should handle null and primitives', () => {
      expect(canonicalizeJson(null)).toEqual(new Uint8Array(Buffer.from('null', 'utf8')));
      expect(canonicalizeJson(true)).toEqual(new Uint8Array(Buffer.from('true', 'utf8')));
      expect(canonicalizeJson('test')).toEqual(new Uint8Array(Buffer.from('"test"', 'utf8')));
      expect(canonicalizeJson(42)).toEqual(new Uint8Array(Buffer.from('42', 'utf8')));
    });

    it('should handle empty structures', () => {
      expect(canonicalizeJson({})).toEqual(new Uint8Array(Buffer.from('{}', 'utf8')));
      expect(canonicalizeJson([])).toEqual(new Uint8Array(Buffer.from('[]', 'utf8')));
    });
  });
});
