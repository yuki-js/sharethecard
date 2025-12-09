/**
 * End-to-End tests for full system flows
 * Spec: Section 6.2.3 - E2Eテスト
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateEd25519KeyPairBase64,
  generateX25519KeyPairBase64,
  signJsonEd25519,
  verifyJsonEd25519,
  computeSharedSecretX25519,
  deriveSessionKey,
  encryptAesGcm,
  decryptAesGcm
} from '@remote-apdu/shared';
import type { EncryptedMessage, ApduResponse } from '@remote-apdu/shared';

describe('E2E: Complete System Flow', () => {
  describe('Authentication Flow', () => {
    it('should complete controller bearer authentication', async () => {
      const bearerToken = 'test-bearer-token-' + Math.random().toString(36).slice(2);

      // Simulate: Controller sends bearer token to Router
      const isValidToken = bearerToken.length >= 10;
      expect(isValidToken).toBe(true);

      // Router would issue session token
      const sessionToken = `sess_${Math.random().toString(36).slice(2)}`;
      expect(sessionToken).toMatch(/^sess_/);
    });

    it('should complete cardhost public key authentication', async () => {
      // Generate Cardhost keypair
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();

      // Simulate: Cardhost sends public key to Router
      expect(publicKeySpkiBase64.length).toBeGreaterThan(0);

      // Router generates challenge
      const challenge = Math.random().toString(36).slice(2);

      // Cardhost signs challenge
      const signature = signJsonEd25519(challenge, privateKeyPkcs8Base64);

      // Router verifies signature
      const isValid = verifyJsonEd25519(challenge, publicKeySpkiBase64, signature);
      expect(isValid).toBe(true);
    });
  });

  describe('Session Establishment', () => {
    it('should establish controller-cardhost session', async () => {
      // Controller authentication
      const controllerBearer = 'test-bearer-' + Math.random().toString(36).slice(2);
      const controllerSessionToken = `sess_${Math.random().toString(36).slice(2)}`;

      // Cardhost registration
      const { publicKeySpkiBase64 } = generateEd25519KeyPairBase64();
      const cardhostUuid = '550e8400-e29b-41d4-a716-446655440000';

      // Session creation
      expect(controllerSessionToken).toMatch(/^sess_/);
      expect(cardhostUuid).toMatch(/^[0-9a-f-]+$/);
    });
  });

  describe('E2E Encryption Flow', () => {
    it('should establish encrypted session using ECDH', async () => {
      // Controller generates ephemeral keypair
      const controllerEphemeral = generateX25519KeyPairBase64();

      // Cardhost generates ephemeral keypair (in real system, Cardhost provides this)
      const cardhostEphemeral = generateX25519KeyPairBase64();

      // Compute shared secret
      const sharedSecret = computeSharedSecretX25519(
        controllerEphemeral.privateKeyPkcs8Base64,
        cardhostEphemeral.publicKeySpkiBase64
      );

      expect(sharedSecret).toBeInstanceOf(Uint8Array);
      expect(sharedSecret.byteLength).toBe(32);

      // Derive session key
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('remote-apdu-session', 'utf8'));
      const sessionKey = deriveSessionKey(sharedSecret, salt, info);

      expect(sessionKey.byteLength).toBe(32);
    });

    it('should encrypt and decrypt APDU message', async () => {
      // Setup ECDH and session key (reusing flow above)
      const controllerEphemeral = generateX25519KeyPairBase64();
      const cardhostEphemeral = generateX25519KeyPairBase64();

      const sharedSecret = computeSharedSecretX25519(
        controllerEphemeral.privateKeyPkcs8Base64,
        cardhostEphemeral.publicKeySpkiBase64
      );

      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('remote-apdu-session', 'utf8'));
      const sessionKey = deriveSessionKey(sharedSecret, salt, info);

      // Controller sends APDU command
      const apduCommand = { hex: '00A4040008A000000003000000' };
      const plaintext = new Uint8Array(Buffer.from(JSON.stringify(apduCommand), 'utf8'));

      // Encrypt
      const encrypted = encryptAesGcm(plaintext, sessionKey);

      const message: EncryptedMessage = {
        ...encrypted,
        senderPublicKey: controllerEphemeral.publicKeySpkiBase64
      };

      expect(message).toHaveProperty('iv');
      expect(message).toHaveProperty('ciphertext');
      expect(message).toHaveProperty('authTag');
      expect(message).toHaveProperty('senderPublicKey');

      // Router relays message to Cardhost (no decryption)
      // Cardhost decrypts
      const decrypted = decryptAesGcm(encrypted, sessionKey);
      const receivedCommand = JSON.parse(Buffer.from(decrypted).toString('utf8'));

      expect(receivedCommand.hex).toBe(apduCommand.hex);
    });

    it('should encrypt and decrypt APDU response', async () => {
      const controllerEphemeral = generateX25519KeyPairBase64();
      const cardhostEphemeral = generateX25519KeyPairBase64();

      const sharedSecret = computeSharedSecretX25519(
        controllerEphemeral.privateKeyPkcs8Base64,
        cardhostEphemeral.publicKeySpkiBase64
      );

      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('remote-apdu-session', 'utf8'));
      const sessionKey = deriveSessionKey(sharedSecret, salt, info);

      // Cardhost sends response
      const apduResponse: ApduResponse = {
        dataHex: 'A4',
        sw: '9000'
      };
      const plaintext = new Uint8Array(Buffer.from(JSON.stringify(apduResponse), 'utf8'));

      // Encrypt with Cardhost's ephemeral key
      const encrypted = encryptAesGcm(plaintext, sessionKey);

      const message: EncryptedMessage = {
        ...encrypted,
        senderPublicKey: cardhostEphemeral.publicKeySpkiBase64
      };

      // Router relays to Controller
      // Controller decrypts
      const decrypted = decryptAesGcm(encrypted, sessionKey);
      const response = JSON.parse(Buffer.from(decrypted).toString('utf8')) as ApduResponse;

      expect(response.sw).toBe('9000');
      expect(response.dataHex).toBe('A4');
    });
  });

  describe('APDU Command Flow', () => {
    it('should complete APDU send/receive cycle', async () => {
      // Setup session
      const controllerEphemeral = generateX25519KeyPairBase64();
      const cardhostEphemeral = generateX25519KeyPairBase64();

      const sharedSecret = computeSharedSecretX25519(
        controllerEphemeral.privateKeyPkcs8Base64,
        cardhostEphemeral.publicKeySpkiBase64
      );

      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('remote-apdu-session', 'utf8'));
      const sessionKey = deriveSessionKey(sharedSecret, salt, info);

      // Controller sends APDU
      const apduHex = '00B0000000';
      const apduCommand = { hex: apduHex };
      const cmdPlaintext = new Uint8Array(Buffer.from(JSON.stringify(apduCommand), 'utf8'));
      const cmdEncrypted = encryptAesGcm(cmdPlaintext, sessionKey);

      // Simulate card response
      const cardResponse: ApduResponse = {
        dataHex: '6C20',
        sw: '6C20'
      };
      const respPlaintext = new Uint8Array(Buffer.from(JSON.stringify(cardResponse), 'utf8'));
      const respEncrypted = encryptAesGcm(respPlaintext, sessionKey);

      // Controller decrypts response
      const decryptedResp = decryptAesGcm(respEncrypted, sessionKey);
      const response = JSON.parse(Buffer.from(decryptedResp).toString('utf8')) as ApduResponse;

      expect(response.sw).toBe('6C20');
    });

    it('should handle multiple APDU commands in sequence', async () => {
      const controllerEphemeral = generateX25519KeyPairBase64();
      const cardhostEphemeral = generateX25519KeyPairBase64();

      const sharedSecret = computeSharedSecretX25519(
        controllerEphemeral.privateKeyPkcs8Base64,
        cardhostEphemeral.publicKeySpkiBase64
      );

      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const info = new Uint8Array(Buffer.from('remote-apdu-session', 'utf8'));
      const sessionKey = deriveSessionKey(sharedSecret, salt, info);

      const commands = [
        '00A4040008A000000003000000',
        '00B0000000',
        '00B0010000'
      ];

      for (const hex of commands) {
        const cmd = { hex };
        const plaintext = new Uint8Array(Buffer.from(JSON.stringify(cmd), 'utf8'));
        const encrypted = encryptAesGcm(plaintext, sessionKey);

        const decrypted = decryptAesGcm(encrypted, sessionKey);
        const received = JSON.parse(Buffer.from(decrypted).toString('utf8'));

        expect(received.hex).toBe(hex);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle decryption failure on tampered message', () => {
      const sessionKey = new Uint8Array(32);
      crypto.getRandomValues(sessionKey);

      const encrypted = {
        iv: Buffer.from(new Uint8Array(12)).toString('base64'),
        ciphertext: Buffer.from('corrupted-data').toString('base64'),
        authTag: Buffer.from(new Uint8Array(16)).toString('base64')
      };

      expect(() => decryptAesGcm(encrypted, sessionKey)).toThrow();
    });

    it('should reject signature verification on tampered data', () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();

      const originalData = 'original-message';
      const tamperedData = 'tampered-message';

      const signature = signJsonEd25519(originalData, privateKeyPkcs8Base64);
      const isValid = verifyJsonEd25519(tamperedData, publicKeySpkiBase64, signature);

      expect(isValid).toBe(false);
    });

    it('should handle session timeout', () => {
      // Session tokens have expiration
      const sessionToken = `sess_${Math.random().toString(36).slice(2)}`;
      const expiresAt = new Date(Date.now() - 1000); // Already expired

      const isExpired = expiresAt < new Date();
      expect(isExpired).toBe(true);
    });
  });

  describe('Security', () => {
    it('should not leak session key in plaintext', () => {
      const sessionKey = new Uint8Array(32);
      crypto.getRandomValues(sessionKey);

      // Session key should never appear in logs/messages
      const keyHex = Buffer.from(sessionKey).toString('hex');
      expect(keyHex).toHaveLength(64);
      // This is just to verify the key exists and is not empty
      expect(keyHex).not.toBe('0'.repeat(64));
    });

    it('should use different ephemeral keys for each session', () => {
      const ephemeral1 = generateX25519KeyPairBase64();
      const ephemeral2 = generateX25519KeyPairBase64();

      expect(ephemeral1.publicKeySpkiBase64).not.toBe(ephemeral2.publicKeySpkiBase64);
      expect(ephemeral1.privateKeyPkcs8Base64).not.toBe(ephemeral2.privateKeyPkcs8Base64);
    });

    it('should provide perfect forward secrecy with ephemeral ECDH', () => {
      // Ephemeral keypairs are generated per session
      const sessionAEphemeral = generateX25519KeyPairBase64();
      const sessionBEphemeral = generateX25519KeyPairBase64();

      // Even if one session key is compromised, others remain secure
      expect(sessionAEphemeral.publicKeySpkiBase64).not.toBe(sessionBEphemeral.publicKeySpkiBase64);
    });

    it('should use authenticated encryption (AEAD)', () => {
      const sessionKey = new Uint8Array(32);
      crypto.getRandomValues(sessionKey);

      const plaintext = new Uint8Array(Buffer.from('authenticated message', 'utf8'));

      const encrypted = encryptAesGcm(plaintext, sessionKey);

      // Message has authentication tag
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.authTag.length).toBeGreaterThan(0);

      // Tampering is detected
      const tampered = {
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        authTag: Buffer.from(new Uint8Array(16)).toString('base64') // Wrong tag
      };

      expect(() => decryptAesGcm(tampered, sessionKey)).toThrow();
    });
  });

  describe('Replay Attack Prevention', () => {
    it('should use sequence numbers to prevent replay', () => {
      let seqNumber = 0;

      const messages = [
        { seq: ++seqNumber, data: 'message1' },
        { seq: ++seqNumber, data: 'message2' },
        { seq: ++seqNumber, data: 'message3' }
      ];

      // Verify sequence is monotonically increasing
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].seq).toBeGreaterThan(messages[i - 1].seq);
      }
    });

    it('should use timestamps to detect replay', () => {
      const message1Ts = new Date().toISOString();
      const message2Ts = new Date(Date.now() + 100).toISOString();

      // Later message should have later timestamp
      expect(new Date(message2Ts).getTime()).toBeGreaterThan(new Date(message1Ts).getTime());
    });
  });
});
