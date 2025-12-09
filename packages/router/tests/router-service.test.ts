/**
 * Unit tests for RouterService
 * 
 * Tests core router functionality, authentication coordination, and relay management
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RouterService } from '../src/lib/router-service.js';
import { webcrypto } from 'node:crypto';

// Helper to generate Ed25519 keypair
async function generateEd25519KeyPair() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;

  const publicKeySpki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyPkcs8 = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    publicKey: Buffer.from(publicKeySpki).toString('base64'),
    privateKey: Buffer.from(privateKeyPkcs8).toString('base64'),
    keyPair
  };
}

// Helper to sign challenge
async function signChallenge(challenge: string, privateKeyBase64: string): Promise<string> {
  const privateKeyDer = Buffer.from(privateKeyBase64, 'base64');
  const privateKey = await webcrypto.subtle.importKey(
    'pkcs8',
    privateKeyDer,
    { name: 'Ed25519' },
    false,
    ['sign']
  );

  const payload = new Uint8Array(Buffer.from(JSON.stringify(challenge), 'utf8'));
  const signature = await webcrypto.subtle.sign({ name: 'Ed25519' }, privateKey, payload);

  return Buffer.from(signature).toString('base64');
}

describe('RouterService', () => {
  let router: RouterService;

  beforeEach(async () => {
    router = new RouterService({ port: 0 });
    await router.start();
  });

  afterEach(async () => {
    await router.stop();
  });

  describe('Service Lifecycle', () => {
    it('should start successfully', async () => {
      expect(router.isRunning()).toBe(true);
    });

    it('should stop successfully', async () => {
      await router.stop();

      expect(router.isRunning()).toBe(false);
    });

    it('should not start if already running', async () => {
      await expect(router.start()).rejects.toThrow('already running');
    });

    it('should handle stop when not running', async () => {
      await router.stop();
      await router.stop(); // Should not throw

      expect(router.isRunning()).toBe(false);
    });
  });

  describe('Controller Authentication', () => {
    it('should authenticate controller with valid bearer token', async () => {
      const token = 'valid-bearer-token-123';

      const sessionToken = await router.authenticateController(token);

      expect(sessionToken.token).toMatch(/^sess_/);
      expect(sessionToken.expiresAt).toBeDefined();
    });

    it('should reject short bearer token', async () => {
      const shortToken = 'short';

      await expect(
        router.authenticateController(shortToken)
      ).rejects.toThrow('Invalid bearer token');
    });

    it('should validate session tokens', async () => {
      const sessionToken = await router.authenticateController('valid-bearer-123');

      const isValid = router.validateControllerSession(sessionToken.token);

      expect(isValid).toBe(true);
    });

    it('should reject invalid session tokens', () => {
      const isValid = router.validateControllerSession('invalid-session');

      expect(isValid).toBe(false);
    });
  });

  describe('Cardhost Authentication', () => {
    it('should complete challenge-response authentication', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      // Step 1: Initiate auth (get challenge)
      const challenge = await router.initiateCardhostAuth(uuid, publicKey);

      expect(challenge).toBeDefined();
      expect(challenge.length).toBeGreaterThan(0);

      // Step 2: Sign challenge
      const signature = await signChallenge(challenge, privateKey);

      // Step 3: Verify signature
      const isAuthenticated = await router.verifyCardhostAuth(uuid, challenge, signature);

      expect(isAuthenticated).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const { publicKey } = await generateEd25519KeyPair();
      const uuid = '550e8400-e29b-41d4-a716-446655440001';

      const challenge = await router.initiateCardhostAuth(uuid, publicKey);

      // Use wrong signature
      const invalidSignature = Buffer.from(new Uint8Array(64)).toString('base64');

      const isAuthenticated = await router.verifyCardhostAuth(uuid, challenge, invalidSignature);

      expect(isAuthenticated).toBe(false);
    });

    it('should mark cardhost as connected after successful auth', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const uuid = '550e8400-e29b-41d4-a716-446655440002';

      const challenge = await router.initiateCardhostAuth(uuid, publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await router.verifyCardhostAuth(uuid, challenge, signature);

      expect(router.isCardhostConnected(uuid)).toBe(true);
    });

    it('should reject mismatched challenge', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const uuid = '550e8400-e29b-41d4-a716-446655440003';

      const challenge1 = await router.initiateCardhostAuth(uuid, publicKey);
      const challenge2 = 'different-challenge';
      const signature = await signChallenge(challenge2, privateKey);

      await expect(
        router.verifyCardhostAuth(uuid, challenge2, signature)
      ).rejects.toThrow('Challenge');
    });
  });

  describe('Relay Session Creation', () => {
    it('should create relay session with authenticated parties', async () => {
      // Authenticate controller
      const controllerToken = 'valid-bearer-123';
      const sessionToken = await router.authenticateController(controllerToken);

      // Authenticate cardhost
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const cardhostUuid = '550e8400-e29b-41d4-a716-446655440004';
      const challenge = await router.initiateCardhostAuth(cardhostUuid, publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await router.verifyCardhostAuth(cardhostUuid, challenge, signature);

      // Create relay session
      const relayId = router.createRelaySession(sessionToken.token, cardhostUuid);

      expect(relayId).toBeDefined();
      expect(relayId.length).toBeGreaterThan(0);
    });

    it('should reject relay with invalid controller session', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const cardhostUuid = '550e8400-e29b-41d4-a716-446655440005';
      
      const challenge = await router.initiateCardhostAuth(cardhostUuid, publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await router.verifyCardhostAuth(cardhostUuid, challenge, signature);

      expect(() => {
        router.createRelaySession('invalid-session', cardhostUuid);
      }).toThrow('Invalid or expired controller session');
    });

    it('should reject relay with disconnected cardhost', async () => {
      const controllerToken = 'valid-bearer-123';
      const sessionToken = await router.authenticateController(controllerToken);

      expect(() => {
        router.createRelaySession(sessionToken.token, 'non-existent-uuid');
      }).toThrow('not connected');
    });
  });

  describe('Cardhost Listing', () => {
    it('should return empty list when no cardhosts', () => {
      const cardhosts = router.listCardhosts();

      expect(cardhosts).toEqual([]);
    });

    it('should list registered cardhosts', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const uuid1 = '550e8400-e29b-41d4-a716-446655440006';
      const uuid2 = '550e8400-e29b-41d4-a716-446655440007';

      // Register two cardhosts
      await router.initiateCardhostAuth(uuid1, publicKey);
      await router.initiateCardhostAuth(uuid2, publicKey);

      const cardhosts = router.listCardhosts();

      expect(cardhosts).toHaveLength(2);
      expect(cardhosts.some(c => c.uuid === uuid1)).toBe(true);
      expect(cardhosts.some(c => c.uuid === uuid2)).toBe(true);
    });

    it('should show connection status in listing', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const uuid = '550e8400-e29b-41d4-a716-446655440008';

      // Register but not authenticate
      await router.initiateCardhostAuth(uuid, publicKey);

      let cardhosts = router.listCardhosts();
      expect(cardhosts[0].connected).toBe(false);

      // Complete authentication
      const challenge = await router.initiateCardhostAuth(uuid, publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await router.verifyCardhostAuth(uuid, challenge, signature);

      cardhosts = router.listCardhosts();
      expect(cardhosts[0].connected).toBe(true);
    });
  });

  describe('Service Statistics', () => {
    it('should provide service statistics', () => {
      const stats = router.getStats();

      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('activeControllers');
      expect(stats).toHaveProperty('activeCardhosts');
      expect(stats).toHaveProperty('activeSessions');
      expect(stats).toHaveProperty('connectedCardhosts');
    });

    it('should show running status', () => {
      const stats = router.getStats();

      expect(stats.running).toBe(true);
    });

    it('should count active entities', async () => {
      // Add controller
      await router.authenticateController('bearer-1');
      
      // Add cardhost
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const uuid = '550e8400-e29b-41d4-a716-446655440009';
      const challenge = await router.initiateCardhostAuth(uuid, publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await router.verifyCardhostAuth(uuid, challenge, signature);

      const stats = router.getStats();

      expect(stats.activeControllers).toBeGreaterThan(0);
      expect(stats.connectedCardhosts).toBeGreaterThan(0);
    });
  });
});