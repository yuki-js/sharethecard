/**
 * Unit tests for Router
 *
 * Tests core router functionality, authentication coordination, and relay management
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { Router } from "../../src/router.js";
import { authenticateController, authenticateCardhost } from "../helpers/auth-helpers.js";
import { generateEd25519KeyPair, signChallenge } from "../helpers/crypto.js";

describe("Router", () => {
  let router: Router;

  beforeEach(async () => {
    router = new Router({ port: 0 });
    await router.start();
  });

  afterEach(async () => {
    await router.stop();
  });

  describe("Service Lifecycle", () => {
    it("should start successfully", async () => {
      expect(router.isRunning()).toBe(true);
    });

    it("should stop successfully", async () => {
      await router.stop();
      expect(router.isRunning()).toBe(false);
    });

    it("should not start if already running", async () => {
      await expect(router.start()).rejects.toThrow("already running");
    });

    it("should handle stop when not running", async () => {
      await router.stop();
      await router.stop(); // Should not throw
      expect(router.isRunning()).toBe(false);
    });
  });

  describe("Controller Authentication", () => {
    it("should authenticate controller with public key", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } =
        await router.controllerUseCase.initiateAuth(publicKey);

      expect(controllerId).toBeDefined();
      expect(controllerId).toMatch(/^peer_/);
      expect(challenge).toBeDefined();
      expect(challenge.length).toBeGreaterThan(0);

      const signature = await signChallenge(challenge, privateKey);
      const isAuthenticated = await router.controllerUseCase.verifyAuth(
        controllerId,
        challenge,
        signature,
      );

      expect(isAuthenticated).toBe(true);
    });

    it("should reject invalid signature", async () => {
      const { publicKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } =
        await router.controllerUseCase.initiateAuth(publicKey);

      const invalidSignature = Buffer.from(new Uint8Array(64)).toString(
        "base64",
      );

      const isAuthenticated = await router.controllerUseCase.verifyAuth(
        controllerId,
        challenge,
        invalidSignature,
      );

      expect(isAuthenticated).toBe(false);
    });

    it("should validate authenticated status", async () => {
      const { controllerId } = await authenticateController(
        router.controllerUseCase,
      );

      expect(router.controllerUseCase.isAuthenticated(controllerId)).toBe(true);
    });

    it("should reject unauthenticated controller", () => {
      expect(
        router.controllerUseCase.isAuthenticated("non-existent"),
      ).toBe(false);
    });
  });

  describe("Cardhost Authentication", () => {
    it("should complete challenge-response authentication", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { uuid, challenge } = await router.cardhostUseCase.initiateAuth(
        publicKey,
      );

      expect(uuid).toBeDefined();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(challenge).toBeDefined();
      expect(challenge.length).toBeGreaterThan(0);

      const signature = await signChallenge(challenge, privateKey);
      const isAuthenticated = await router.cardhostUseCase.verifyAuth(
        uuid,
        challenge,
        signature,
      );

      expect(isAuthenticated).toBe(true);
    });

    it("should reject invalid signature", async () => {
      const { publicKey } = await generateEd25519KeyPair();

      const { uuid, challenge } = await router.cardhostUseCase.initiateAuth(
        publicKey,
      );

      const invalidSignature = Buffer.from(new Uint8Array(64)).toString(
        "base64",
      );

      const isAuthenticated = await router.cardhostUseCase.verifyAuth(
        uuid,
        challenge,
        invalidSignature,
      );

      expect(isAuthenticated).toBe(false);
    });

    it("should mark cardhost as connected after successful auth", async () => {
      const { uuid } = await authenticateCardhost(router.cardhostUseCase);

      expect(router.cardhostUseCase.isConnected(uuid)).toBe(true);
    });

    it("should reject mismatched challenge", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      await router.cardhostUseCase.initiateAuth(publicKey);
      const challenge2 = "different-challenge";
      const signature = await signChallenge(challenge2, privateKey);

      const { uuid } = await router.cardhostUseCase.initiateAuth(publicKey);

      await expect(
        router.cardhostUseCase.verifyAuth(uuid, challenge2, signature),
      ).rejects.toThrow("Challenge");
    });
  });

  describe("Session Creation", () => {
    it("should create session with authenticated parties", async () => {
      const { controllerId } = await authenticateController(
        router.controllerUseCase,
      );
      const { uuid: cardhostUuid } = await authenticateCardhost(
        router.cardhostUseCase,
      );

      const sessionToken = router.controllerUseCase.createSession(
        controllerId,
        cardhostUuid,
      );

      expect(sessionToken.token).toBeDefined();
      expect(sessionToken.token.length).toBeGreaterThan(0);
    });

    it("should reject session with unauthenticated controller", async () => {
      const { uuid: cardhostUuid } = await authenticateCardhost(
        router.cardhostUseCase,
      );

      expect(() => {
        router.controllerUseCase.createSession(
          "invalid-controller",
          cardhostUuid,
        );
      }).toThrow("not authenticated");
    });

    it("should reject session with disconnected cardhost", async () => {
      const { controllerId } = await authenticateController(
        router.controllerUseCase,
      );

      expect(() => {
        router.controllerUseCase.createSession(
          controllerId,
          "non-existent-uuid",
        );
      }).toThrow("not connected");
    });
  });

  describe("Cardhost Listing", () => {
    it("should return empty list when no cardhosts", () => {
      const cardhosts = router.cardhostUseCase.listCardhosts();
      expect(cardhosts).toEqual([]);
    });

    it("should list registered cardhosts", async () => {
      const { publicKey: pub1 } = await generateEd25519KeyPair();
      const { publicKey: pub2 } = await generateEd25519KeyPair();

      const { uuid: uuid1 } = await router.cardhostUseCase.initiateAuth(pub1);
      const { uuid: uuid2 } = await router.cardhostUseCase.initiateAuth(pub2);

      const cardhosts = router.cardhostUseCase.listCardhosts();

      expect(cardhosts).toHaveLength(2);
      expect(cardhosts.some((c) => c.uuid === uuid1)).toBe(true);
      expect(cardhosts.some((c) => c.uuid === uuid2)).toBe(true);
    });

    it("should show connection status in listing", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { uuid } = await router.cardhostUseCase.initiateAuth(publicKey);

      let cardhosts = router.cardhostUseCase.listCardhosts();
      expect(cardhosts[0].connected).toBe(false);

      const { challenge } = await router.cardhostUseCase.initiateAuth(
        publicKey,
      );
      const signature = await signChallenge(challenge, privateKey);
      await router.cardhostUseCase.verifyAuth(uuid, challenge, signature);

      cardhosts = router.cardhostUseCase.listCardhosts();
      expect(cardhosts[0].connected).toBe(true);
    });
  });

  describe("Service Statistics", () => {
    it("should provide service statistics", () => {
      const stats = router.getStats();

      expect(stats).toHaveProperty("running");
      expect(stats).toHaveProperty("activeControllers");
      expect(stats).toHaveProperty("activeCardhosts");
      expect(stats).toHaveProperty("activeSessions");
      expect(stats).toHaveProperty("connectedCardhosts");
    });

    it("should show running status", () => {
      const stats = router.getStats();
      expect(stats.running).toBe(true);
    });

    it("should count active entities", async () => {
      await authenticateController(router.controllerUseCase);
      await authenticateCardhost(router.cardhostUseCase);

      const stats = router.getStats();
      expect(stats.connectedCardhosts).toBeGreaterThan(0);
    });
  });
});